from datetime import timedelta

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import LiveShareSession, NotificationRecord, SosEvent
from app.services.live_share import share_token
from app.utils.time import utcnow

SMS = {"name": "Asha (dummy)", "phone": "+919800000001", "channel": "sms"}
HERE = {"lat": 28.6139, "lng": 77.209, "accuracy": 12.0}
THERE = {"lat": 28.62, "lng": 77.21, "accuracy": 9.0}


def _auth(client, account, pin):
    r = client.post("/api/auth/unlock", json={"user_id": account, "pin": pin})
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def real(client, account):
    headers = _auth(client, account, "1234")
    client.post("/api/contacts", json=SMS, headers=headers)
    return headers


def _share(account):
    with SessionLocal() as db:
        return db.scalars(select(LiveShareSession).where(LiveShareSession.user_id == account)).one()


def _data(client, share):
    return client.get(f"/api/live-share/{share_token(share.id)}/data")


def _bodies(account):
    with SessionLocal() as db:
        return db.scalars(
            select(NotificationRecord.body)
            .join(SosEvent, NotificationRecord.sos_event_id == SosEvent.id)
            .where(SosEvent.user_id == account)
            .order_by(NotificationRecord.created_at)
        ).all()


def _stream(client, headers, location=HERE):
    return client.post("/api/sos/context", json={"location": location}, headers=headers).json()


def test_sos_creates_a_share_and_puts_its_link_in_the_alert(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    share = _share(account)
    assert f"/api/live-share/{share_token(share.id)}" in _bodies(account)[0]
    assert _data(client, share).json()["status"] == "active"


def test_context_streams_only_while_a_share_is_active(client, account, real):
    assert _stream(client, real) == {"stream": False, "stream_token": None}
    client.post("/api/sos", json={}, headers=real)
    assert _stream(client, real)["stream"] is True


def test_breadcrumb_trail_is_visible_on_the_private_map_in_order(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    token = _stream(client, real, HERE)["stream_token"]
    stream = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/live-share/location", json={"location": THERE}, headers=stream).json()["stream"] is True

    data = _data(client, _share(account)).json()
    assert [(p["lat"], p["lng"]) for p in data["points"]] == [(HERE["lat"], HERE["lng"]), (THERE["lat"], THERE["lng"])]


def test_share_pages_are_private(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    share = _share(account)
    for r in (client.get(f"/api/live-share/{share_token(share.id)}"), _data(client, share)):
        assert r.headers["cache-control"] == "no-store"
        assert r.headers["referrer-policy"] == "origin"
        assert "noindex" in r.headers["x-robots-tag"]


@pytest.mark.parametrize("bad", ["0" * 64, "x", "é" * 64])
def test_invalid_link_reveals_nothing(client, account, real, bad):
    client.post("/api/sos", json={}, headers=real)
    assert client.get(f"/api/live-share/{bad}/data").status_code == 404


def test_forged_signature_is_rejected(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    assert client.get(f"/api/live-share/{_share(account).id}{'0' * 32}/data").status_code == 404


def test_stream_token_only_writes_points(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    stream = {"Authorization": f"Bearer {_stream(client, real)['stream_token']}"}
    assert client.get("/api/contacts", headers=stream).status_code == 401
    assert client.post("/api/sos", json={}, headers=stream).status_code == 401
    assert client.post("/api/live-share/stop", headers=stream).status_code == 401
    assert client.get("/api/me", headers=stream).status_code == 401


def test_session_token_cannot_write_points(client, real):
    assert client.post("/api/live-share/location", json={"location": HERE}, headers=real).status_code == 401


def test_im_safe_ends_link_stream_and_tells_contacts(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    stream = {"Authorization": f"Bearer {_stream(client, real)['stream_token']}"}
    assert client.get("/api/live-share", headers=real).json()["active"] is True

    assert client.post("/api/live-share/stop", headers=real).status_code == 204

    assert client.get("/api/live-share", headers=real).json()["active"] is False
    assert client.post("/api/live-share/location", json={"location": THERE}, headers=stream).json()["stream"] is False
    assert _data(client, _share(account)).json() == {"status": "safe"}
    assert "marked themselves safe" in _bodies(account)[-1]
    assert _stream(client, real)["stream"] is False


def test_duress_session_streams_but_cannot_see_or_cancel_the_share(client, account, real):
    duress = _auth(client, account, "9876")

    reply = _stream(client, duress)
    assert reply["stream"] is True and reply["stream_token"]
    hidden = client.get("/api/live-share", headers=duress).json()
    assert hidden["active"] is False and hidden["share_url"] is None and hidden["points"] == []

    # A forced "I'm safe" answers the same but changes nothing.
    assert client.post("/api/live-share/stop", headers=duress).status_code == 204
    assert client.get("/api/live-share", headers=real).json()["active"] is True
    assert _data(client, _share(account)).json()["status"] == "active"
    assert not any("marked themselves safe" in b for b in _bodies(account))


def test_expired_share_shows_no_location_and_stops_stream(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    stream = {"Authorization": f"Bearer {_stream(client, real)['stream_token']}"}
    with SessionLocal() as db:
        share = db.scalars(select(LiveShareSession).where(LiveShareSession.user_id == account)).one()
        share.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()

    assert _data(client, _share(account)).json() == {"status": "expired"}
    assert client.post("/api/live-share/location", json={"location": THERE}, headers=stream).json()["stream"] is False
    assert client.get("/api/live-share", headers=real).json()["active"] is False


def test_repeat_sos_keeps_one_share(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    client.post("/api/sos", json={}, headers=real)
    assert _share(account) is not None  # .one() raises if there are two


def test_new_sos_after_safe_gets_a_new_link(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    old = _share(account)
    client.post("/api/live-share/stop", headers=real)
    client.post("/api/sos", json={}, headers=real)
    with SessionLocal() as db:
        shares = db.scalars(select(LiveShareSession).where(LiveShareSession.user_id == account)).all()
    assert len(shares) == 2
    assert _data(client, old).json() == {"status": "safe"}


# ---------- survivor-started sharing and the survivor's own view ----------


def test_survivor_can_start_a_share_without_an_sos(client, account, real):
    started = client.post("/api/live-share", json={"location": HERE}, headers=real)
    assert started.status_code == 200
    body = started.json()
    assert body["active"] is True and body["stream_token"]
    assert body["share_url"].endswith(share_token(_share(account).id))
    assert [v["name"] for v in body["viewers"]] == [SMS["name"]]
    assert [(p["lat"], p["lng"]) for p in body["points"]] == [(HERE["lat"], HERE["lng"])]

    message = _bodies(account)[0]
    assert "sharing their live location" in message and "SILENT SOS" not in message
    with SessionLocal() as db:
        assert db.scalars(select(SosEvent.trigger).where(SosEvent.user_id == account)).all() == ["share"]


def test_starting_twice_keeps_one_share_and_tells_contacts_once(client, account, real):
    first = client.post("/api/live-share", json={}, headers=real).json()
    second = client.post("/api/live-share", json={"location": THERE}, headers=real).json()
    assert first["share_url"] == second["share_url"]
    assert len(_bodies(account)) == 1


def test_own_status_shows_trail_and_only_emergency_contacts(client, account, real):
    client.post("/api/contacts", json={**SMS, "name": "Not for alerts", "is_emergency": False}, headers=real)
    token = client.post("/api/live-share", json={"location": HERE}, headers=real).json()["stream_token"]
    client.post("/api/live-share/location", json={"location": THERE}, headers={"Authorization": f"Bearer {token}"})

    status = client.get("/api/live-share", headers=real).json()
    assert [(p["lat"], p["lng"]) for p in status["points"]] == [(HERE["lat"], HERE["lng"]), (THERE["lat"], THERE["lng"])]
    assert [v["name"] for v in status["viewers"]] == [SMS["name"]]


def test_share_forced_under_duress_is_a_decoy_nobody_is_told_about(client, account, real):
    duress = _auth(client, account, "9876")
    alerts_before = len(_bodies(account))

    forced = client.post("/api/live-share", json={"location": THERE}, headers=duress).json()
    assert forced["active"] is True
    # The device keeps feeding the real share, so the forced tap can't redirect the trail.
    assert forced["stream_token"]
    real_share = client.get("/api/live-share", headers=real).json()
    assert forced["share_url"] != real_share["share_url"]
    assert len(_bodies(account)) == alerts_before

    # The decoy link works but shows no location, and never the real name.
    decoy_data = client.get(forced["share_url"].split("localhost:8000")[1] + "/data").json()
    assert decoy_data["status"] == "active" and decoy_data["points"] == [] and decoy_data["name"] == ""


def test_forced_stop_under_duress_ends_only_the_decoy(client, account, real):
    duress = _auth(client, account, "9876")
    client.post("/api/live-share", json={}, headers=duress)
    assert client.get("/api/live-share", headers=duress).json()["active"] is True

    assert client.post("/api/live-share/stop", headers=duress).status_code == 204

    assert client.get("/api/live-share", headers=duress).json()["active"] is False
    assert client.get("/api/live-share", headers=real).json()["active"] is True
    assert not any("marked themselves safe" in b for b in _bodies(account))


def test_a_link_never_shows_another_shares_trail(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    client.post("/api/sos/context", json={"location": HERE}, headers=real)
    first = _share(account)
    client.post("/api/live-share/stop", headers=real)
    client.post("/api/sos", json={}, headers=real)

    with SessionLocal() as db:
        second = db.scalars(
            select(LiveShareSession).where(LiveShareSession.user_id == account, LiveShareSession.ended_at.is_(None))
        ).one()
    assert _data(client, second).json()["points"] == []
    assert _data(client, first).json() == {"status": "safe"}
