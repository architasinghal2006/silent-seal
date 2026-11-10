import uuid

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import LiveShareSession, NotificationRecord, SosEvent
from app.services.live_share import share_token
from app.utils.geo import haversine_m, inside_zone

from conftest import unlock

SMS = {"name": "Asha (dummy)", "phone": "+919800000001", "channel": "sms"}
HERE = {"lat": 28.6139, "lng": 77.209, "accuracy": 12.0}
ZONE = {"name": "Dummy place", "kind": "danger", "lat": 28.6, "lng": 77.2, "radius": 200}
IV = "eHh4eHh4eHh4eHh4"
B64 = "b3BhcXVl"


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _event(kind, payload=None):
    return {"id": uuid.uuid4().hex, "type": kind, "payload": payload or {}}


def _sync(client, headers, *events):
    return client.post("/api/offline/sync", json={"events": list(events)}, headers=headers)


def _bodies(user_id):
    with SessionLocal() as db:
        return db.scalars(
            select(NotificationRecord.body)
            .join(SosEvent, NotificationRecord.sos_event_id == SosEvent.id)
            .where(SosEvent.user_id == user_id)
        ).all()


# ---------- distance ----------


def test_haversine_matches_known_distances():
    assert haversine_m(28.6139, 77.2090, 28.6139, 77.2090) == 0
    # One degree of latitude is about 111.2 km anywhere on Earth.
    assert haversine_m(0, 0, 1, 0) == pytest.approx(111_195, rel=1e-3)
    # New Delhi to Mumbai, great-circle.
    assert haversine_m(28.6139, 77.2090, 19.0760, 72.8777) == pytest.approx(1_148_000, rel=0.01)
    # A degree of longitude shrinks with latitude.
    assert haversine_m(60, 0, 60, 1) == pytest.approx(haversine_m(0, 0, 0, 1) / 2, rel=1e-3)


def test_inside_zone_uses_the_radius():
    centre = (28.6, 77.2)
    about_150_m_north = (28.6 + 150 / 111_195, 77.2)
    assert inside_zone(*about_150_m_north, *centre, 200) is True
    assert inside_zone(*about_150_m_north, *centre, 100) is False
    assert inside_zone(*centre, *centre, 50) is True


# ---------- management ----------


def test_zones_are_validated(client, real):
    for bad in ({**ZONE, "radius": 5}, {**ZONE, "lat": 200}, {**ZONE, "kind": "other"}, {**ZONE, "name": ""}):
        assert client.post("/api/zones", json=bad, headers=real).status_code == 422


def test_zone_defaults_follow_its_type(client, real):
    danger = client.post("/api/zones", json=ZONE, headers=real).json()["zones"][0]
    assert (danger["enabled"], danger["on_enter"], danger["on_exit"]) == (True, True, False)
    safe = client.post("/api/zones", json={**ZONE, "name": "Home", "kind": "safe"}, headers=real).json()["zones"][1]
    assert (safe["on_enter"], safe["on_exit"]) == (False, True)


def test_zone_can_be_edited(client, real):
    zone_id = client.post("/api/zones", json=ZONE, headers=real).json()["zones"][0]["id"]
    changed = {**ZONE, "name": "College", "kind": "safe", "radius": 450, "on_enter": True, "on_exit": True}

    reply = client.put(f"/api/zones/{zone_id}", json=changed, headers=real)

    assert reply.status_code == 200
    zone = reply.json()["zones"][0]
    assert (zone["name"], zone["kind"], zone["radius"], zone["on_enter"], zone["on_exit"]) == ("College", "safe", 450, True, True)
    assert reply.json()["watch"] == [
        {"i": zone_id, "a": ZONE["lat"], "o": ZONE["lng"], "r": 450, "k": "s", "e": True, "x": True}
    ]


def test_disabled_or_silent_zones_are_not_watched(client, real):
    made = client.post("/api/zones", json=ZONE, headers=real).json()
    zone_id = made["zones"][0]["id"]
    assert len(made["watch"]) == 1 and made["watch_token"]

    off = client.put(f"/api/zones/{zone_id}", json={**ZONE, "enabled": False}, headers=real).json()
    assert off["zones"][0]["enabled"] is False
    assert off["watch"] == [] and off["watch_token"] is None

    silent = client.put(
        f"/api/zones/{zone_id}", json={**ZONE, "on_enter": False, "on_exit": False}, headers=real
    ).json()
    assert silent["watch"] == [] and silent["watch_token"] is None


def test_zones_are_isolated_between_users(client, real):
    zone_id = client.post("/api/zones", json=ZONE, headers=real).json()["zones"][0]["id"]
    other = client.post("/api/auth/setup", json={"real_pin": "4321", "duress_pin": "8765"}).json()["user_id"]
    theirs = unlock(client, other, "4321")
    assert client.get("/api/zones", headers=theirs).json() == {"zones": [], "watch": [], "watch_token": None}
    assert client.put(f"/api/zones/{zone_id}", json=ZONE, headers=theirs).status_code == 404
    assert client.delete(f"/api/zones/{zone_id}", headers=theirs).status_code == 404
    assert client.get("/api/zones").status_code == 401


def test_duress_sees_no_zones_but_the_watcher_keeps_the_real_ones(client, account, real):
    made = client.post("/api/zones", json=ZONE, headers=real).json()
    assert [w["k"] for w in made["watch"]] == ["d"]
    zone_id = made["zones"][0]["id"]

    duress = unlock(client, account, "9876")
    seen = client.get("/api/zones", headers=duress).json()
    assert seen["zones"] == []
    assert [w["i"] for w in seen["watch"]] == [zone_id]
    assert seen["watch_token"]
    assert client.delete(f"/api/zones/{zone_id}", headers=duress).status_code == 404
    assert client.put(f"/api/zones/{zone_id}", json={**ZONE, "enabled": False}, headers=duress).status_code == 404

    decoy = client.post("/api/zones", json={**ZONE, "name": "Forced"}, headers=duress).json()
    assert [z["name"] for z in decoy["zones"]] == ["Forced"]
    assert [w["i"] for w in decoy["watch"]] == [zone_id]
    assert [z["name"] for z in client.get("/api/zones", headers=real).json()["zones"]] == [ZONE["name"]]


def test_deleting_the_last_zone_stops_the_watcher(client, real):
    zone_id = client.post("/api/zones", json=ZONE, headers=real).json()["zones"][0]["id"]
    after = client.delete(f"/api/zones/{zone_id}", headers=real).json()
    assert after == {"zones": [], "watch": [], "watch_token": None}


# ---------- alerts from the watcher ----------


@pytest.fixture()
def watch(client, real):
    client.post("/api/contacts", json=SMS, headers=real)
    return _bearer(client.post("/api/zones", json=ZONE, headers=real).json()["watch_token"])


def test_watch_token_only_sends_zone_alerts(client, account, watch):
    refused = _sync(
        client,
        watch,
        _event("sos", {"trigger": "manual"}),
        _event("unlock"),
        _event("evidence", {"iv": IV, "ciphertext": B64, "wrapped_key": B64}),
    )
    assert [r["status"] for r in refused.json()["results"]] == ["rejected", "rejected", "rejected"]
    assert _bodies(account) == []
    assert client.get("/api/contacts", headers=watch).status_code == 401

    trail = [{"lat": 28.61, "lng": 77.20}, {"lat": 28.62, "lng": 77.21}]
    fired = _sync(
        client,
        watch,
        _event("sos", {"trigger": "geofence", "zone_event": "entered", "zone_kind": "danger", "location": HERE, "trail": trail}),
    )
    assert fired.json()["results"][0]["status"] == "applied" and fired.json()["stream"] is True
    assert "entered an area they marked as dangerous" in _bodies(account)[0]
    with SessionLocal() as db:
        share = db.scalars(select(LiveShareSession).where(LiveShareSession.user_id == account)).one()
    assert len(client.get(f"/api/live-share/{share_token(share.id)}/data").json()["points"]) == 3


@pytest.mark.parametrize(
    "kind,event,sentence",
    [
        ("danger", "entered", "entered an area they marked as dangerous"),
        ("danger", "left", "left an area they marked as dangerous"),
        ("safe", "entered", "arrived at a place they marked as safe"),
        ("safe", "left", "left an area they marked as safe"),
    ],
)
def test_message_says_what_happened_at_the_zone(client, account, watch, kind, event, sentence):
    _sync(client, watch, _event("sos", {"trigger": "geofence", "zone_event": event, "zone_kind": kind}))
    assert f"Sent automatically: they {sentence}." in _bodies(account)[0]


def test_zone_alert_from_an_older_device_still_reads_correctly(client, account, watch):
    _sync(client, watch, _event("sos", {"trigger": "geofence", "zone_event": "left"}))
    assert "left an area they marked as safe" in _bodies(account)[0]
