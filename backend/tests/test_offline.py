import uuid

import pytest
from sqlalchemy import func, select

from app import models
from app.db import SessionLocal
from app.models import Delivery, LiveShare, SosEvent

SMS = {"name": "Asha (dummy)", "phone": "+919800000001", "channel": "sms"}
HERE = {"lat": 28.6139, "lng": 77.209, "accuracy": 12.0}
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
ZONE = {"name": "Dummy place", "kind": "danger", "lat": 28.6, "lng": 77.2, "radius": 200}


@pytest.fixture()
def accounts(client):
    r = client.post("/api/auth/setup", json={"real_pin": "1234", "duress_pin": "9876"})
    assert r.status_code == 201
    return r.json()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _auth(client, account, pin):
    return _bearer(client.post("/api/auth/unlock", json={"account_id": account, "pin": pin}).json()["token"])


def _id():
    return uuid.uuid4().hex


def _events(account):
    with SessionLocal() as db:
        return db.scalars(select(SosEvent).where(SosEvent.account_id == account).order_by(SosEvent.created_at)).all()


def _bodies(account):
    with SessionLocal() as db:
        return db.scalars(
            select(Delivery.body).join(SosEvent, Delivery.sos_event_id == SosEvent.id).where(SosEvent.account_id == account)
        ).all()


def test_setup_gives_two_tokens_that_look_alike(accounts):
    assert accounts["offline_real"] != accounts["offline_duress"]
    assert abs(len(accounts["offline_real"]) - len(accounts["offline_duress"])) < 8


def test_offline_tokens_are_not_session_tokens(client, accounts):
    token = _bearer(accounts["offline_real"])
    assert client.get("/api/contacts", headers=token).status_code == 401
    assert client.post("/api/sos", json={}, headers=token).status_code == 401
    assert client.get("/api/vault/entries", headers=token).status_code == 401


def test_session_token_cannot_use_offline_routes(client, accounts):
    real = _auth(client, accounts["account_id"], "1234")
    assert client.post("/api/offline/sos", json={"client_id": _id()}, headers=real).status_code == 401


def test_queued_sos_alerts_contacts_with_delay_note_and_location(client, accounts):
    account = accounts["account_id"]
    client.post("/api/contacts", json=SMS, headers=_auth(client, account, "1234"))
    r = client.post(
        "/api/offline/sos",
        json={"client_id": _id(), "client_ts": "2026-01-01T10:00:00Z", "location": HERE, "battery": 0.5},
        headers=_bearer(accounts["offline_real"]),
    )
    assert r.status_code == 200
    assert r.json()["stream"] is True and r.json()["stream_token"]
    body = _bodies(account)[0]
    assert "delayed" in body and "mlat=28.6139" in body and "/api/share/" in body


def test_recent_alert_has_no_delay_note(client, account):
    real = _auth(client, account, "1234")
    client.post("/api/contacts", json=SMS, headers=real)
    client.post("/api/sos", json={}, headers=real)
    assert "delayed" not in _bodies(account)[0]


def test_retried_item_only_takes_effect_once(client, accounts):
    account = accounts["account_id"]
    client.post("/api/contacts", json=SMS, headers=_auth(client, account, "1234"))
    body = {"client_id": _id()}
    token = _bearer(accounts["offline_real"])
    client.post("/api/offline/sos", json=body, headers=token)
    assert client.post("/api/offline/sos", json=body, headers=token).status_code == 200
    assert len(_events(account)) == 1
    assert len(_bodies(account)) == 1


def test_offline_real_unlock_is_discarded(client, accounts):
    account = accounts["account_id"]
    r = client.post(
        "/api/offline/unlocked",
        json={"client_id": _id(), "location": HERE},
        headers=_bearer(accounts["offline_real"]),
    )
    assert r.json() == {"stream": False, "stream_token": None}
    assert _events(account) == []


def test_offline_duress_unlock_fires_the_sos_and_replies_alike(client, accounts):
    account = accounts["account_id"]
    client.post("/api/contacts", json=SMS, headers=_auth(client, account, "1234"))
    item = {"client_id": _id(), "client_ts": "2026-01-01T10:00:00Z", "location": HERE}
    r = client.post("/api/offline/unlocked", json=item, headers=_bearer(accounts["offline_duress"]))
    assert r.status_code == 200 and set(r.json()) == {"stream", "stream_token"}
    assert [e.trigger for e in _events(account)] == ["duress"]
    body = _bodies(account)[0]
    assert "duress PIN" in body and "delayed" in body and "mlat=28.6139" in body

    client.post("/api/offline/unlocked", json=item, headers=_bearer(accounts["offline_duress"]))
    assert len(_events(account)) == 1


def test_offline_clip_joins_real_side_only(client, accounts):
    account = accounts["account_id"]
    real = _auth(client, account, "1234")
    client.put("/api/vault/meta", json=META, headers=real)
    clip = {"client_id": _id(), "iv": IV, "ciphertext": B64, "wrapped_key": B64}

    assert client.post("/api/offline/clip", json=clip, headers=_bearer(accounts["offline_real"])).status_code == 201
    client.post("/api/offline/clip", json=clip, headers=_bearer(accounts["offline_real"]))
    assert len(client.get("/api/vault/clips", headers=real).json()) == 1

    other = {**clip, "client_id": _id()}
    assert client.post("/api/offline/clip", json=other, headers=_bearer(accounts["offline_duress"])).status_code == 201
    assert len(client.get("/api/vault/clips", headers=real).json()) == 1
    duress = _auth(client, account, "9876")
    assert client.get("/api/vault/clips", headers=duress).json() == []


def test_restored_device_can_get_a_token_for_its_session(client, accounts):
    real = _auth(client, accounts["account_id"], "1234")
    token = client.get("/api/offline/token", headers=real).json()["token"]
    assert client.post("/api/offline/sos", json={"client_id": _id()}, headers=_bearer(token)).status_code == 200


# ---------- zones ----------


def test_zones_are_validated(client, account):
    real = _auth(client, account, "1234")
    for bad in ({**ZONE, "radius": 5}, {**ZONE, "lat": 200}, {**ZONE, "kind": "other"}, {**ZONE, "name": ""}):
        assert client.post("/api/zones", json=bad, headers=real).status_code == 422


def test_duress_sees_no_zones_but_the_watcher_keeps_the_real_ones(client, account):
    real = _auth(client, account, "1234")
    made = client.post("/api/zones", json=ZONE, headers=real).json()
    assert [w["k"] for w in made["watch"]] == ["d"]
    assert made["watch_token"]
    zone_id = made["zones"][0]["id"]

    duress = _auth(client, account, "9876")
    seen = client.get("/api/zones", headers=duress).json()
    assert seen["zones"] == []
    assert [w["i"] for w in seen["watch"]] == [zone_id]
    assert seen["watch_token"]
    assert client.delete(f"/api/zones/{zone_id}", headers=duress).status_code == 404

    decoy = client.post("/api/zones", json={**ZONE, "name": "Forced"}, headers=duress).json()
    assert [z["name"] for z in decoy["zones"]] == ["Forced"]
    assert [w["i"] for w in decoy["watch"]] == [zone_id]
    assert [z["name"] for z in client.get("/api/zones", headers=real).json()["zones"]] == [ZONE["name"]]


def test_deleting_the_last_zone_stops_the_watcher(client, account):
    real = _auth(client, account, "1234")
    zone_id = client.post("/api/zones", json=ZONE, headers=real).json()["zones"][0]["id"]
    after = client.delete(f"/api/zones/{zone_id}", headers=real).json()
    assert after == {"zones": [], "watch": [], "watch_token": None}


def test_watch_token_only_sends_zone_alerts(client, account):
    real = _auth(client, account, "1234")
    client.post("/api/contacts", json=SMS, headers=real)
    token = _bearer(client.post("/api/zones", json=ZONE, headers=real).json()["watch_token"])

    assert client.post("/api/offline/sos", json={"client_id": _id(), "trigger": "manual"}, headers=token).status_code == 403
    assert client.post("/api/offline/unlocked", json={"client_id": _id()}, headers=token).status_code == 403
    clip = {"client_id": _id(), "iv": IV, "ciphertext": B64, "wrapped_key": B64}
    assert client.post("/api/offline/clip", json=clip, headers=token).status_code == 403

    trail = [{"lat": 28.61, "lng": 77.20}, {"lat": 28.62, "lng": 77.21}]
    fired = client.post(
        "/api/offline/sos",
        json={"client_id": _id(), "trigger": "geofence", "zone_event": "entered", "location": HERE, "trail": trail},
        headers=token,
    )
    assert fired.status_code == 200 and fired.json()["stream"] is True
    assert "area they marked as dangerous" in _bodies(account)[0]
    with SessionLocal() as db:
        share = db.scalars(select(LiveShare).where(LiveShare.account_id == account)).one()
    assert len(client.get(f"/api/share/{_token(share.id)}/data").json()["points"]) == 3


def _token(share_id):
    from app.services.live import share_token

    return share_token(share_id)


def test_left_safe_zone_message(client, account):
    real = _auth(client, account, "1234")
    client.post("/api/contacts", json=SMS, headers=real)
    token = _bearer(client.post("/api/zones", json=ZONE, headers=real).json()["watch_token"])
    client.post("/api/offline/sos", json={"client_id": _id(), "trigger": "geofence", "zone_event": "left"}, headers=token)
    assert "area they marked as safe" in _bodies(account)[0]


# ---------- erase ----------


def _rows_for(account):
    """Every row anywhere that belongs to the account, so a new table can't be missed by accident."""
    found = {}
    with SessionLocal() as db:
        for mapper in models.Base.registry.mappers:
            table = mapper.class_
            if hasattr(table, "account_id"):
                found[table.__name__] = db.scalar(select(func.count()).select_from(table).where(table.account_id == account))
        found["Account"] = db.scalar(select(func.count()).select_from(models.Account).where(models.Account.id == account))
    return {name: n for name, n in found.items() if n}


def _fill(client, accounts, headers):
    client.post("/api/contacts", json=SMS, headers=headers)
    client.put("/api/profile", json={"alert_name": "Dummy"}, headers=headers)
    client.post("/api/zones", json=ZONE, headers=headers)
    client.put("/api/vault/meta", json=META, headers=headers)
    client.post("/api/vault/clips", json={"iv": IV, "ciphertext": B64, "wrapped_key": B64}, headers=headers)
    client.post("/api/sos", json={}, headers=headers)
    client.post("/api/sos/context", json={"location": HERE}, headers=headers)
    client.post("/api/offline/sos", json={"client_id": _id()}, headers=_bearer(accounts["offline_real"]))


def test_erase_needs_the_right_pin(client, accounts):
    account = accounts["account_id"]
    real = _auth(client, account, "1234")
    assert client.post("/api/account/erase", json={"pin": "0000"}, headers=real).status_code == 401
    assert client.post("/api/account/erase", json={"pin": "9876"}, headers=real).status_code == 401
    assert _rows_for(account)


def test_erase_removes_every_row_and_kills_links_and_tokens(client, accounts):
    account = accounts["account_id"]
    real = _auth(client, account, "1234")
    _fill(client, accounts, real)
    with SessionLocal() as db:
        share = db.scalars(select(LiveShare).where(LiveShare.account_id == account)).first()
        event_ids = db.scalars(select(SosEvent.id).where(SosEvent.account_id == account)).all()
    url = f"/api/share/{_token(share.id)}/data"
    assert client.get(url).status_code == 200

    assert client.post("/api/account/erase", json={"pin": "1234"}, headers=real).status_code == 204

    assert _rows_for(account) == {}
    with SessionLocal() as db:
        assert db.scalars(select(Delivery).where(Delivery.sos_event_id.in_(event_ids))).first() is None
        assert db.scalars(select(models.Breadcrumb).where(models.Breadcrumb.share_id == share.id)).first() is None
    assert client.get(url).status_code == 404
    assert client.post("/api/offline/sos", json={"client_id": _id()}, headers=_bearer(accounts["offline_real"])).status_code == 401
    assert client.post("/api/auth/unlock", json={"account_id": account, "pin": "1234"}).status_code == 401


def test_forced_erase_under_duress_leaves_the_real_side_untouched(client, accounts):
    account = accounts["account_id"]
    real = _auth(client, account, "1234")
    _fill(client, accounts, real)
    before = _rows_for(account)
    duress = _auth(client, account, "9876")
    client.post("/api/contacts", json={**SMS, "name": "Forced"}, headers=duress)
    client.post("/api/zones", json={**ZONE, "name": "Forced"}, headers=duress)

    assert client.post("/api/account/erase", json={"pin": "1234"}, headers=duress).status_code == 401
    assert client.post("/api/account/erase", json={"pin": "9876"}, headers=duress).status_code == 204

    after = _rows_for(account)
    # The duress unlock itself added an SOS, so compare everything the survivor owns.
    for name in ("Contact", "Zone", "VaultMeta", "VaultClip", "Profile", "Account"):
        assert after[name] == before[name], name
    assert client.get("/api/contacts", headers=duress).json() == []
    assert [c["name"] for c in client.get("/api/contacts", headers=real).json()] == [SMS["name"]]
