"""The schema migrations: a fresh database, and one created before migrations existed."""

import hashlib

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app.database import Base, alembic_config, run_migrations
from app.security import hash_pin, verify_pin

NOW = "2026-10-01 09:30:00.000000"
IV = "eHh4eHh4eHh4eHh4"


def _entry_hash(seq, prev, iv, ciphertext):
    return hashlib.sha256(f"{seq}|{prev}|{iv}|{ciphertext}".encode()).hexdigest()


@pytest.fixture()
def legacy(tmp_path):
    """A database exactly as the pre-migration app left it: old tables, real rows, no version table."""
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    config = alembic_config()
    with engine.connect() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0001")
        connection.execute(text("DROP TABLE alembic_version"))

        first = _entry_hash(1, "0" * 64, IV, "Y2lwaGVyMQ==")
        second = _entry_hash(2, first, IV, "Y2lwaGVyMg==")
        rows = [
            ("INSERT INTO accounts VALUES ('u1', :real, :duress, 2, NULL, :now)", {"real": hash_pin("1234"), "duress": hash_pin("9876")}),
            ("INSERT INTO profiles VALUES ('u1', 'Meera', '')", {}),
            ("INSERT INTO contacts VALUES ('c1', 'u1', 'Asha', '+919800000001', NULL, 'sms', 0, :now)", {}),
            ("INSERT INTO contacts VALUES ('c2', 'u1', 'Forced', '+919800000099', NULL, 'sms', 1, :now)", {}),
            ("INSERT INTO sos_events VALUES ('e1', 'u1', 'manual', 'dispatched', '{\"battery\": 0.5}', :now)", {}),
            ("INSERT INTO deliveries VALUES ('d1', 'e1', 'Asha', 'sms', '+919800000001', 'initial', 'mock', 'sent', NULL, 'body', :now)", {}),
            ("INSERT INTO live_shares VALUES ('s1', 'u1', 'e1', :now, NULL, :now)", {}),
            ("INSERT INTO breadcrumbs VALUES ('b1', 's1', 28.6, 77.2, 12.0, :now)", {}),
            ("INSERT INTO vault_meta VALUES ('u1', 0, 'salt', 600000, :iv, 'vct', '{}', :iv, 'pct', :now)", {"iv": IV}),
            ("INSERT INTO vault_entries VALUES ('v1', 'u1', 0, 1, :genesis, :iv, 'Y2lwaGVyMQ==', :hash, :now)", {"genesis": "0" * 64, "iv": IV, "hash": first}),
            ("INSERT INTO vault_entries VALUES ('v2', 'u1', 0, 2, :prev, :iv, 'Y2lwaGVyMg==', :hash, :now)", {"prev": first, "iv": IV, "hash": second}),
            ("INSERT INTO vault_clips VALUES ('k1', 'u1', 0, :iv, 'Y2xpcA==', 'd3JhcA==', :now)", {"iv": IV}),
            ("INSERT INTO zones VALUES ('z1', 'u1', 0, 'Riverside', 'danger', 28.6, 77.2, 300, :now)", {}),
            ("INSERT INTO zones VALUES ('z2', 'u1', 0, 'Home', 'safe', 28.61, 77.21, 200, :now)", {}),
            ("INSERT INTO offline_receipts VALUES ('abcdef0123456789', 'u1', :now)", {}),
        ]
        for sql, params in rows:
            wanted = {k: v for k, v in {**params, "now": NOW}.items() if f":{k}" in sql}
            connection.execute(text(sql), wanted)
        connection.commit()
    yield engine, (first, second)
    engine.dispose()


def _one(engine, sql):
    with engine.connect() as connection:
        return connection.execute(text(sql)).mappings().one()


def _all(engine, sql):
    with engine.connect() as connection:
        return [dict(row) for row in connection.execute(text(sql)).mappings().all()]


def test_fresh_database_matches_the_models(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    run_migrations(engine)
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    engine.dispose()


def test_legacy_database_is_upgraded_in_place_with_its_data(legacy):
    engine, (first, second) = legacy

    run_migrations(engine)

    tables = set(inspect(engine).get_table_names())
    assert {"users", "auth_credentials", "evidence_items", "evidence_chain_entries", "offline_queue_events"} <= tables
    assert not {"accounts", "deliveries", "live_shares", "breadcrumbs", "vault_entries", "vault_clips", "offline_receipts"} & tables
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []

    # The account, and both PINs still unlock.
    assert _one(engine, "SELECT id, is_demo FROM users")["id"] == "u1"
    credential = _one(engine, "SELECT * FROM auth_credentials")
    assert verify_pin("1234", credential["real_pin_hash"]) and verify_pin("9876", credential["duress_pin_hash"])
    assert credential["failed_attempts"] == 2

    # Contacts keep their side, and everyone who used to get alerts still does.
    contacts = _all(engine, "SELECT id, user_id, decoy, is_emergency, relationship FROM contacts ORDER BY id")
    assert [(c["id"], c["user_id"], bool(c["decoy"]), bool(c["is_emergency"]), c["relationship"]) for c in contacts] == [
        ("c1", "u1", False, True, ""),
        ("c2", "u1", True, True, ""),
    ]

    # Zones behave as their type always did.
    zones = _all(engine, "SELECT name, enabled, on_enter, on_exit FROM zones ORDER BY name")
    assert [(z["name"], bool(z["enabled"]), bool(z["on_enter"]), bool(z["on_exit"])) for z in zones] == [
        ("Home", True, False, True),
        ("Riverside", True, True, False),
    ]

    assert _one(engine, "SELECT sos_event_id, adapter, status FROM notification_records")["adapter"] == "mock"
    share = _one(engine, "SELECT id, user_id, sos_event_id, decoy FROM live_share_sessions")
    assert (share["user_id"], share["sos_event_id"], bool(share["decoy"])) == ("u1", "e1", False)
    assert _one(engine, "SELECT share_id, lat FROM location_points")["share_id"] == "s1"
    assert bool(_one(engine, "SELECT simulated FROM sos_events")["simulated"]) is False
    assert _one(engine, "SELECT user_id, ciphertext FROM evidence_clips")["ciphertext"] == "Y2xpcA=="
    receipt = _one(engine, "SELECT user_id, event_id, duplicates FROM offline_queue_events")
    assert (receipt["user_id"], receipt["event_id"], receipt["duplicates"]) == ("u1", "abcdef0123456789", 0)


def test_evidence_chain_survives_the_split_unchanged(legacy):
    engine, (first, second) = legacy
    run_migrations(engine)

    chain = _all(
        engine,
        "SELECT c.seq, c.prev_hash, c.payload_hash, c.entry_hash, c.evidence_id, i.iv, i.ciphertext "
        "FROM evidence_chain_entries c JOIN evidence_items i ON i.id = c.evidence_id ORDER BY c.seq",
    )
    # Entry hashes are sealed into each entry's encryption, so they must come through untouched.
    assert [(c["seq"], c["prev_hash"], c["entry_hash"]) for c in chain] == [(1, "0" * 64, first), (2, first, second)]
    for link in chain:
        assert link["entry_hash"] == _entry_hash(link["seq"], link["prev_hash"], link["iv"], link["ciphertext"])
        assert link["payload_hash"] == hashlib.sha256(f"{link['iv']}|{link['ciphertext']}".encode()).hexdigest()


def test_running_again_changes_nothing(legacy):
    engine, _ = legacy
    run_migrations(engine)
    before = _all(engine, "SELECT * FROM contacts ORDER BY id")
    run_migrations(engine)
    assert _all(engine, "SELECT * FROM contacts ORDER BY id") == before
    assert _one(engine, "SELECT version_num FROM alembic_version")["version_num"] == "0002"
