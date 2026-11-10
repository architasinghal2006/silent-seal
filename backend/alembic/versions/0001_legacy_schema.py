"""The schema as it stood before migrations were introduced.

Databases created back then (by create_all) are stamped with this revision rather than
having it run, so their data carries forward into every later migration.

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _account_fk() -> sa.ForeignKey:
    return sa.ForeignKey("accounts.id", ondelete="CASCADE")


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("real_pin_hash", sa.String(200), nullable=False),
        sa.Column("duress_pin_hash", sa.String(200), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "sos_events",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("account_id", sa.String(32), _account_fk(), nullable=False),
        sa.Column("trigger", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("payload", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_sos_events_account_id", "sos_events", ["account_id"])
    op.create_table(
        "profiles",
        sa.Column("account_id", sa.String(32), _account_fk(), primary_key=True),
        sa.Column("alert_name", sa.String(80), nullable=False),
        sa.Column("decoy_alert_name", sa.String(80), nullable=False),
    )
    op.create_table(
        "contacts",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("account_id", sa.String(32), _account_fk(), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("channel", sa.String(10), nullable=False),
        sa.Column("decoy", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_contacts_account_id", "contacts", ["account_id"])
    op.create_table(
        "deliveries",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("sos_event_id", sa.String(32), sa.ForeignKey("sos_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contact_name", sa.String(80), nullable=False),
        sa.Column("channel", sa.String(10), nullable=False),
        sa.Column("destination", sa.String(254), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("adapter", sa.String(20), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_deliveries_sos_event_id", "deliveries", ["sos_event_id"])
    op.create_table(
        "live_shares",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("account_id", sa.String(32), _account_fk(), nullable=False),
        sa.Column("sos_event_id", sa.String(32), sa.ForeignKey("sos_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_live_shares_account_id", "live_shares", ["account_id"])
    op.create_table(
        "breadcrumbs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("share_id", sa.String(32), sa.ForeignKey("live_shares.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("accuracy", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_breadcrumbs_share_id", "breadcrumbs", ["share_id"])
    op.create_table(
        "vault_meta",
        sa.Column("account_id", sa.String(32), _account_fk(), primary_key=True),
        sa.Column("decoy", sa.Boolean(), primary_key=True),
        sa.Column("salt", sa.String(64), nullable=False),
        sa.Column("iterations", sa.Integer(), nullable=False),
        sa.Column("verifier_iv", sa.String(32), nullable=False),
        sa.Column("verifier_ct", sa.String(128), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("private_iv", sa.String(32), nullable=False),
        sa.Column("private_ct", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "vault_entries",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("account_id", sa.String(32), _account_fk(), nullable=False),
        sa.Column("decoy", sa.Boolean(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("prev_hash", sa.String(64), nullable=False),
        sa.Column("iv", sa.String(32), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("entry_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("account_id", "decoy", "seq", name="uq_vault_chain_position"),
    )
    op.create_index("ix_vault_entries_account_id", "vault_entries", ["account_id"])
    op.create_table(
        "vault_clips",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("account_id", sa.String(32), _account_fk(), nullable=False),
        sa.Column("decoy", sa.Boolean(), nullable=False),
        sa.Column("iv", sa.String(32), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("wrapped_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_vault_clips_account_id", "vault_clips", ["account_id"])
    op.create_table(
        "zones",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("account_id", sa.String(32), _account_fk(), nullable=False),
        sa.Column("decoy", sa.Boolean(), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("radius", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_zones_account_id", "zones", ["account_id"])
    op.create_table(
        "offline_receipts",
        sa.Column("client_id", sa.String(64), primary_key=True),
        sa.Column("account_id", sa.String(32), _account_fk(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_offline_receipts_account_id", "offline_receipts", ["account_id"])


def downgrade() -> None:
    for table in (
        "offline_receipts",
        "zones",
        "vault_clips",
        "vault_entries",
        "vault_meta",
        "breadcrumbs",
        "live_shares",
        "deliveries",
        "contacts",
        "profiles",
        "sos_events",
        "accounts",
    ):
        op.drop_table(table)
