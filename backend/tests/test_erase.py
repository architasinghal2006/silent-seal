import uuid

import pytest
from sqlalchemy import func, select

from app import models
from app.database import Base, SessionLocal
from app.models import LiveShareSession, LocationPoint, NotificationRecord, SosEvent
from app.services.live_share import share_token

from conftest import unlock

SMS = {"name": "Asha (dummy)", "phone": "+919800000001", "channel": "sms"}
HERE = {"lat": 28.6139, "lng": 77.209, "accuracy": 12.0}
ZONE = {"name": "Dummy place", "kind": "danger", "lat": 28.6, "lng": 77.2, "radius": 200}
IV = "eHh4eHh4eHh4eHh4"
B64 = "b3BhcXVl"
META = {
    "salt": "c3Nzc3Nzc3Nzc3Nzc3Nzcw==",
    "iterations": 600000,
    "verifier_iv": IV,
    "verifier_ct": B64,
    "public_key": '{"kty":"RSA"}',
    "private_iv": IV,
    "private_ct": B64,
}


@pytest.fixture()
def tokens(client):
    return client.post("/api/auth/setup", json={"real_pin": "1234", "duress_pin": "9876"}).json()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _sync_sos(client, token):
    event = {"id": uuid.uuid4().hex, "type": "sos", "payload": {}}
    return client.post("/api/offline/sync", json={"events": [event]}, headers=_bearer(token))


def _rows_for(user_id):
    """Every row anywhere that belongs to the user, so a new table can't be missed by accident."""
    found = {}
    with SessionLocal() as db:
        for mapper in Base.registry.mappers:
            table = mapper.class_
            if hasattr(table, "user_id"):
                found[table.__name__] = db.scalar(select(func.count()).select_from(table).where(table.user_id == user_id))
        found["User"] = db.scalar(select(func.count()).select_from(models.User).where(models.User.id == user_id))
    return {name: n for name, n in found.items() if n}


def _fill(client, tokens, headers):
    """Puts at least one row in every table that can hold a user's data."""
    from app.services.chain import GENESIS_HASH, entry_hash

    client.post("/api/contacts", json=SMS, headers=headers)
    client.put("/api/profile", json={"alert_name": "Dummy"}, headers=headers)
    client.post("/api/zones", json=ZONE, headers=headers)
    client.put("/api/vault/meta", json=META, headers=headers)
    entry = {"seq": 1, "prev_hash": GENESIS_HASH, "iv": IV, "ciphertext": B64, "entry_hash": entry_hash(1, GENESIS_HASH, IV, B64)}
    client.post("/api/vault/evidence", json=entry, headers=headers)
    client.post("/api/vault/clips", json={"iv": IV, "ciphertext": B64, "wrapped_key": B64}, headers=headers)
    client.post("/api/sos", json={}, headers=headers)
    client.post("/api/sos/context", json={"location": HERE}, headers=headers)
    _sync_sos(client, tokens["offline_real"])


def test_fill_touches_every_user_table(client, tokens):
    """Guards the erase tests: if a new table is added, this fails until _fill covers it."""
    user = tokens["user_id"]
    _fill(client, tokens, unlock(client, user, "1234"))
    owned = {m.class_.__name__ for m in Base.registry.mappers if hasattr(m.class_, "user_id")} | {"User"}
    assert set(_rows_for(user)) == owned


def test_erase_needs_the_right_pin(client, tokens):
    user = tokens["user_id"]
    real = unlock(client, user, "1234")
    assert client.post("/api/account/erase", json={"pin": "0000"}, headers=real).status_code == 401
    assert client.post("/api/account/erase", json={"pin": "9876"}, headers=real).status_code == 401
    assert _rows_for(user)


def test_erase_removes_every_row_and_kills_links_and_tokens(client, tokens):
    user = tokens["user_id"]
    real = unlock(client, user, "1234")
    _fill(client, tokens, real)
    with SessionLocal() as db:
        share = db.scalars(select(LiveShareSession).where(LiveShareSession.user_id == user)).first()
        event_ids = db.scalars(select(SosEvent.id).where(SosEvent.user_id == user)).all()
    url = f"/api/live-share/{share_token(share.id)}/data"
    assert client.get(url).status_code == 200

    assert client.post("/api/account/erase", json={"pin": "1234"}, headers=real).status_code == 204

    assert _rows_for(user) == {}
    with SessionLocal() as db:
        assert db.scalars(select(NotificationRecord).where(NotificationRecord.sos_event_id.in_(event_ids))).first() is None
        assert db.scalars(select(LocationPoint).where(LocationPoint.share_id == share.id)).first() is None
    assert client.get(url).status_code == 404
    assert _sync_sos(client, tokens["offline_real"]).status_code == 401
    assert client.post("/api/auth/unlock", json={"user_id": user, "pin": "1234"}).status_code == 401


def test_forced_erase_under_duress_leaves_the_real_side_untouched(client, tokens):
    user = tokens["user_id"]
    real = unlock(client, user, "1234")
    _fill(client, tokens, real)
    before = _rows_for(user)
    duress = unlock(client, user, "9876")
    client.post("/api/contacts", json={**SMS, "name": "Forced"}, headers=duress)
    client.post("/api/zones", json={**ZONE, "name": "Forced"}, headers=duress)
    client.post("/api/live-share", json={}, headers=duress)

    assert client.post("/api/account/erase", json={"pin": "1234"}, headers=duress).status_code == 401
    assert client.post("/api/account/erase", json={"pin": "9876"}, headers=duress).status_code == 204

    after = _rows_for(user)
    # The duress unlock itself added an SOS, so compare everything the survivor owns.
    for name in ("Contact", "Zone", "VaultMeta", "EvidenceItem", "EvidenceChainEntry", "EvidenceClip", "Profile", "User", "AuthCredential"):
        assert after[name] == before[name], name
    assert client.get("/api/contacts", headers=duress).json() == []
    assert client.get("/api/live-share", headers=duress).json()["active"] is False
    assert [c["name"] for c in client.get("/api/contacts", headers=real).json()] == [SMS["name"]]
    # The real evidence and the real live share both survive the forced erase.
    assert len(client.get("/api/vault/evidence", headers=real).json()) == 1
    assert client.get("/api/live-share", headers=real).json()["active"] is True
