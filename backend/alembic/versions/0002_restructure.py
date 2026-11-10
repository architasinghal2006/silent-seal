"""Restructure to the normalized schema, keeping every existing row.

- accounts becomes users, with PIN hashes and the unlock throttle moved to auth_credentials
- account_id becomes user_id everywhere
- deliveries -> notification_records, live_shares -> live_share_sessions,
  breadcrumbs -> location_points, vault_clips -> evidence_clips
- vault_entries splits into evidence_items (ciphertext) and evidence_chain_entries (the hash chain)
- offline_receipts -> offline_queue_events, keyed per user
- new: contact relationship and emergency flag, zone preferences, decoy live shares,
  simulated-event flag, audit_events, revoked_tokens

Entry hashes are carried over unchanged: they are bound into each entry's encryption, so
recomputing them would make existing evidence undecryptable.

Revision ID: 0002
Revises: 0001
"""

import hashlib

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _user_fk() -> sa.ForeignKey:
    return sa.ForeignKey("users.id", ondelete="CASCADE")


def _rename_owner(table: str, old_index: str | None, new_index: str | None, extra=None) -> None:
    """account_id -> user_id on one table, with its index, plus any table-specific changes."""
    with op.batch_alter_table(table) as batch:
        if old_index:
            batch.drop_index(old_index)
        batch.alter_column("account_id", new_column_name="user_id")
        if extra:
            extra(batch)
    if new_index:
        op.create_index(new_index, table, ["user_id"])


def upgrade() -> None:
    bind = op.get_bind()

    # --- users and their credentials ---
    op.rename_table("accounts", "users")
    op.create_table(
        "auth_credentials",
        sa.Column("user_id", sa.String(32), _user_fk(), primary_key=True),
        sa.Column("real_pin_hash", sa.String(200), nullable=False),
        sa.Column("duress_pin_hash", sa.String(200), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(), nullable=True),
    )
    op.execute(
        "INSERT INTO auth_credentials (user_id, real_pin_hash, duress_pin_hash, failed_attempts, locked_until) "
        "SELECT id, real_pin_hash, duress_pin_hash, failed_attempts, locked_until FROM users"
    )
    with op.batch_alter_table("users") as batch:
        batch.drop_column("real_pin_hash")
        batch.drop_column("duress_pin_hash")
        batch.drop_column("failed_attempts")
        batch.drop_column("locked_until")
        batch.add_column(sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()))

    # --- tables that keep their name ---
    _rename_owner("profiles", None, None)
    _rename_owner("vault_meta", None, None)
    _rename_owner(
        "sos_events",
        "ix_sos_events_account_id",
        "ix_sos_events_user_id",
        lambda b: b.add_column(sa.Column("simulated", sa.Boolean(), nullable=False, server_default=sa.false())),
    )

    def contact_columns(batch) -> None:
        batch.add_column(sa.Column("relationship", sa.String(40), nullable=False, server_default=""))
        # Every existing contact received alerts, so they stay emergency contacts.
        batch.add_column(sa.Column("is_emergency", sa.Boolean(), nullable=False, server_default=sa.true()))

    _rename_owner("contacts", "ix_contacts_account_id", "ix_contacts_user_id", contact_columns)

    def zone_columns(batch) -> None:
        batch.add_column(sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.add_column(sa.Column("on_enter", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("on_exit", sa.Boolean(), nullable=False, server_default=sa.false()))

    _rename_owner("zones", "ix_zones_account_id", "ix_zones_user_id", zone_columns)
    # What each zone type always did before preferences existed.
    op.execute(sa.text("UPDATE zones SET on_enter = :yes WHERE kind = 'danger'").bindparams(yes=True))
    op.execute(sa.text("UPDATE zones SET on_exit = :yes WHERE kind = 'safe'").bindparams(yes=True))

    # --- renamed tables ---
    op.rename_table("deliveries", "notification_records")
    with op.batch_alter_table("notification_records") as batch:
        batch.drop_index("ix_deliveries_sos_event_id")
    op.create_index("ix_notification_records_sos_event_id", "notification_records", ["sos_event_id"])

    op.rename_table("live_shares", "live_share_sessions")

    def share_columns(batch) -> None:
        batch.alter_column("sos_event_id", existing_type=sa.String(32), nullable=True)
        batch.add_column(sa.Column("decoy", sa.Boolean(), nullable=False, server_default=sa.false()))

    _rename_owner("live_share_sessions", "ix_live_shares_account_id", "ix_live_share_sessions_user_id", share_columns)

    op.rename_table("breadcrumbs", "location_points")
    with op.batch_alter_table("location_points") as batch:
        batch.drop_index("ix_breadcrumbs_share_id")
    op.create_index("ix_location_points_share_id", "location_points", ["share_id"])

    op.rename_table("vault_clips", "evidence_clips")
    _rename_owner("evidence_clips", "ix_vault_clips_account_id", "ix_evidence_clips_user_id")

    # --- evidence: ciphertext and chain in separate tables ---
    op.create_table(
        "evidence_items",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(32), _user_fk(), nullable=False),
        sa.Column("decoy", sa.Boolean(), nullable=False),
        sa.Column("iv", sa.String(32), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_evidence_items_user_id", "evidence_items", ["user_id"])
    op.create_table(
        "evidence_chain_entries",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("evidence_id", sa.String(32), sa.ForeignKey("evidence_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(32), _user_fk(), nullable=False),
        sa.Column("decoy", sa.Boolean(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("prev_hash", sa.String(64), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("entry_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("evidence_id"),
        sa.UniqueConstraint("user_id", "decoy", "seq", name="uq_evidence_chain_position"),
    )
    op.create_index("ix_evidence_chain_entries_user_id", "evidence_chain_entries", ["user_id"])
    op.execute(
        "INSERT INTO evidence_items (id, user_id, decoy, iv, ciphertext, created_at) "
        "SELECT id, account_id, decoy, iv, ciphertext, created_at FROM vault_entries"
    )
    op.execute(
        "INSERT INTO evidence_chain_entries "
        "(id, evidence_id, user_id, decoy, seq, prev_hash, payload_hash, entry_hash, created_at) "
        "SELECT id, id, account_id, decoy, seq, prev_hash, '', entry_hash, created_at FROM vault_entries"
    )
    fill = sa.text("UPDATE evidence_chain_entries SET payload_hash = :hash WHERE id = :id")
    for row in bind.execute(sa.text("SELECT id, iv, ciphertext FROM vault_entries")).fetchall():
        digest = hashlib.sha256(f"{row.iv}|{row.ciphertext}".encode()).hexdigest()
        bind.execute(fill, {"hash": digest, "id": row.id})
    op.drop_table("vault_entries")

    # --- offline queue: one row per (user, event) ---
    op.create_table(
        "offline_queue_events",
        sa.Column("user_id", sa.String(32), _user_fk(), primary_key=True),
        sa.Column("event_id", sa.String(64), primary_key=True),
        sa.Column("event_type", sa.String(20), nullable=False),
        sa.Column("client_ts", sa.DateTime(), nullable=True),
        sa.Column("duplicates", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.execute(
        "INSERT INTO offline_queue_events (user_id, event_id, event_type, client_ts, duplicates, created_at) "
        "SELECT account_id, client_id, 'sos', NULL, 0, created_at FROM offline_receipts"
    )
    op.drop_table("offline_receipts")

    # --- new tables ---
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(32), _user_fk(), nullable=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_audit_events_user_id", "audit_events", ["user_id"])
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])
    op.create_table(
        "revoked_tokens",
        sa.Column("jti", sa.String(32), primary_key=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_revoked_tokens_expires_at", "revoked_tokens", ["expires_at"])


def downgrade() -> None:
    raise NotImplementedError("This migration splits and merges tables. Restore from a backup to go back.")
