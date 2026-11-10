"""The judge dashboard and demo tools: gated, clearly labelled, and unable to touch a survivor's real side."""

import uuid
from datetime import timedelta

import jwt
import pytest

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Profile
from app.services import demo_seed
from app.services.erase import erase_account

from conftest import unlock

SMS = {"name": "Asha (dummy)", "phone": "+919800000001", "channel": "sms"}
DEMO_ROUTES = [
    ("GET", "/api/demo/dashboard"),
    ("GET", "/api/demo/alerts"),
    ("GET", "/api/demo/state"),
    ("POST", "/api/demo/simulate-sos"),
    ("POST", "/api/demo/seed"),
    ("POST", "/api/demo/verify"),
    ("POST", "/api/demo/sample"),
]


@pytest.fixture(autouse=True)
def _no_leftover_simulation(client):
    """Tests share one database, so remove the demo sender another test may have left behind."""
    with SessionLocal() as db:
        leftovers = db.scalars(
            select(Profile.user_id).where(Profile.alert_name.in_((demo_seed.DEMO_SENDER_NAME, "Demo account")))
        ).all()
        for user_id in leftovers:
            erase_account(db, user_id)
    yield


def _mine(feed, sender):
    return [a for a in feed if a["sender"] == sender]


@pytest.mark.parametrize("method,path", DEMO_ROUTES)
def test_demo_tools_do_not_exist_unless_enabled(client, real, method, path):
    headers = {**real, "X-Demo-Token": "demo-token"}
    assert client.request(method, path, json={"bundle": {}}, headers=headers).status_code == 404


@pytest.mark.parametrize("method,path", DEMO_ROUTES[1:6])
def test_dashboard_data_needs_the_demo_token(client, demo, method, path):
    assert client.request(method, path, json={"bundle": {}}).status_code == 401
    assert client.request(method, path, json={"bundle": {}}, headers={"X-Demo-Token": "wrong"}).status_code == 401


def test_dashboard_page_is_served_and_never_cached(client, demo):
    page = client.get("/api/demo/dashboard")
    assert page.status_code == 200 and "text/html" in page.headers["content-type"]
    assert page.headers["cache-control"] == "no-store"
    # The page's script is a separate file, so the content policy can forbid inline script.
    assert "<script src=" in page.text and "script-src 'self'" in page.headers["content-security-policy"]


def test_real_alerts_appear_in_the_feed_with_sender_and_live_share(client, account, real, demo):
    client.post("/api/contacts", json=SMS, headers=real)
    client.put("/api/profile", json={"alert_name": "Meera"}, headers=real)
    client.post("/api/sos", json={"battery": 0.42, "location": {"lat": 28.6139, "lng": 77.209}}, headers=real)

    alert = _mine(client.get("/api/demo/alerts", headers=demo).json(), "Meera")[0]

    assert (alert["sender"], alert["trigger"], alert["status"], alert["simulated"]) == ("Meera", "manual", "dispatched", False)
    assert alert["payload"]["battery"] == 0.42 and alert["payload"]["location"]["lat"] == 28.6139
    assert alert["share"]["status"] == "active" and "/api/live-share/" in alert["share"]["url"]
    assert alert["deliveries"][0]["adapter"] == "mock" and alert["deliveries"][0]["status"] == "sent"
    assert alert["created_at"].endswith("Z")

    client.post("/api/live-share/stop", headers=real)
    assert _mine(client.get("/api/demo/alerts", headers=demo).json(), "Meera")[0]["share"]["status"] == "safe"


def test_state_says_plainly_that_nothing_is_delivered_externally(client, demo):
    state = client.get("/api/demo/state", headers=demo).json()
    assert state["notifications"] == {"adapter": "mock", "delivers_externally": False}
    assert set(state) == {"server_time", "notifications", "alerts", "offline", "audit"}


def test_simulated_sos_is_labelled_everywhere_and_uses_the_real_dispatch_path(client, demo):
    made = client.post("/api/demo/simulate-sos", headers=demo)
    assert made.status_code == 200 and "/api/live-share/" in made.json()["share_url"]

    alert = client.get("/api/demo/alerts", headers=demo).json()[0]
    assert alert["id"] == made.json()["event_id"]
    assert alert["simulated"] is True and alert["sender"] == demo_seed.DEMO_SENDER_NAME
    assert alert["status"] == "dispatched" and len(alert["deliveries"]) == 2
    for delivery in alert["deliveries"]:
        assert delivery["body"].startswith("[SIMULATED for demonstration]")
        assert delivery["adapter"] == "mock" and "nothing left this server" in delivery["detail"]
    assert alert["payload"]["battery"] == 0.42


def test_simulated_trail_moves_as_the_dashboard_polls(client, demo, monkeypatch):
    monkeypatch.setattr(demo_seed, "SIMULATION_STEP", timedelta(0))
    link = client.post("/api/demo/simulate-sos", headers=demo).json()["share_url"].split("localhost:8000")[1]
    assert len(client.get(link + "/data").json()["points"]) == 1

    for _ in range(3):
        client.get("/api/demo/state", headers=demo)

    points = client.get(link + "/data").json()["points"]
    assert [(p["lat"], p["lng"]) for p in points] == [pytest.approx(p) for p in demo_seed.ROUTE[:4]]

    # It stops at the end of the route rather than wandering forever.
    for _ in range(len(demo_seed.ROUTE) + 5):
        client.get("/api/demo/state", headers=demo)
    assert len(client.get(link + "/data").json()["points"]) == len(demo_seed.ROUTE)


def test_trail_does_not_advance_faster_than_its_step(client, demo):
    link = client.post("/api/demo/simulate-sos", headers=demo).json()["share_url"].split("localhost:8000")[1]
    for _ in range(3):
        client.get("/api/demo/state", headers=demo)
    assert len(client.get(link + "/data").json()["points"]) == 1


def test_repeat_simulations_share_one_sender(client, demo):
    client.post("/api/demo/simulate-sos", headers=demo)
    client.post("/api/demo/simulate-sos", headers=demo)
    alerts = [a for a in client.get("/api/demo/alerts", headers=demo).json() if a["simulated"]]
    assert len(alerts) == 2 and alerts[0]["share"]["url"] == alerts[1]["share"]["url"]


def test_seeded_account_shows_both_pins_get_the_same_response(client, demo):
    seeded = client.post("/api/demo/seed", headers=demo)
    assert seeded.status_code == 201
    account = seeded.json()

    real = client.post("/api/auth/unlock", json={"user_id": account["user_id"], "pin": account["real_pin"]})
    duress = client.post("/api/auth/unlock", json={"user_id": account["user_id"], "pin": account["duress_pin"]})

    assert real.status_code == duress.status_code == 200 and set(real.json()) == set(duress.json())
    claims = jwt.decode(duress.json()["token"], options={"verify_signature": False})
    assert "duress" not in str(claims).lower()
    # Only the server-side feed shows what the duress PIN did.
    feed = _mine(client.get("/api/demo/alerts", headers=demo).json(), "Demo account")
    assert [a["trigger"] for a in feed] == ["duress"]
    assert "duress PIN" in feed[0]["deliveries"][0]["body"]


def test_dashboard_verification_reports_tampering(client, demo):
    bundle = {"format": "ssv1", "entries": [], "head_hash": "0" * 64, "count": 0}
    ok = client.post("/api/demo/verify", json={"bundle": bundle}, headers=demo).json()
    assert ok["valid"] is True and "does not prove that an event happened" in ok["scope"]

    bad = client.post("/api/demo/verify", json={"bundle": {**bundle, "count": 3}}, headers=demo).json()
    assert bad["valid"] is False and bad["problems"][0]["kind"] == "count_mismatch"


def test_state_lists_offline_events_and_suppressed_duplicates(client, demo):
    tokens = client.post("/api/auth/setup", json={"real_pin": "1234", "duress_pin": "9876"}).json()
    event = {"id": uuid.uuid4().hex, "type": "sos", "timestamp": "2026-01-01T10:00:00Z", "payload": {}}
    headers = {"Authorization": f"Bearer {tokens['offline_real']}"}
    before = client.get("/api/demo/state", headers=demo).json()["offline"]
    for _ in range(3):
        client.post("/api/offline/sync", json={"events": [event]}, headers=headers)
    offline = client.get("/api/demo/state", headers=demo).json()["offline"]

    assert offline["applied"] == before["applied"] + 1
    assert offline["duplicates_suppressed"] == before["duplicates_suppressed"] + 2
    row = next(e for e in offline["events"] if e["id"] == event["id"][:8])
    assert (row["id"], row["type"], row["duplicates"]) == (event["id"][:8], "sos", 2)
    assert row["delay_seconds"] > 3600 and row["queued_at"] == "2026-01-01T10:00:00Z"


# ---------- sample data for the survivor's own screens ----------


def test_sample_data_fills_the_account_and_is_marked_as_sample(client, account, real, demo):
    centre = {"lat": 12.9716, "lng": 77.5946}
    assert client.post("/api/demo/sample", json={"centre": centre}, headers=real).status_code == 204

    contacts = client.get("/api/contacts", headers=real).json()
    assert [(c["name"], c["relationship"], c["is_emergency"]) for c in contacts] == [
        ("Asha Verma", "Sister", True),
        ("Meera Nair", "Friend", True),
        ("Kavita Rao", "Colleague", False),
    ]
    zones = client.get("/api/zones", headers=real).json()["zones"]
    assert {z["name"]: z["kind"] for z in zones} == {"Home": "safe", "Workplace": "safe", "College": "safe", "Riverside lane": "danger"}
    assert all(abs(z["lat"] - centre["lat"]) < 0.05 and abs(z["lng"] - centre["lng"]) < 0.05 for z in zones)

    history = client.get("/api/sos/history", headers=real).json()
    assert len(history) == 2 and all(item["simulated"] for item in history)
    past = client.get(f"/api/sos/{history[0]['id']}", headers=real).json()
    assert {d["adapter"] for d in past["deliveries"]} == {"sample"}
    # Old sample shares are finished: loading samples never starts sharing a location.
    assert client.get("/api/live-share", headers=real).json()["active"] is False
    assert client.get("/api/profile", headers=real).json() == {"alert_name": "Ananya"}


def test_sample_data_is_added_once_and_keeps_what_is_already_there(client, real, demo):
    client.post("/api/contacts", json=SMS, headers=real)
    client.put("/api/profile", json={"alert_name": "Meera"}, headers=real)
    client.post("/api/demo/sample", json={}, headers=real)
    client.post("/api/demo/sample", json={}, headers=real)

    assert [c["name"] for c in client.get("/api/contacts", headers=real).json()] == [SMS["name"]]
    assert len(client.get("/api/zones", headers=real).json()["zones"]) == 4
    assert len(client.get("/api/sos/history", headers=real).json()) == 2
    assert client.get("/api/profile", headers=real).json() == {"alert_name": "Meera"}


def test_sample_data_under_duress_fills_only_the_decoy_side(client, account, real, demo):
    client.post("/api/contacts", json=SMS, headers=real)
    duress = unlock(client, account, "9876")

    assert client.post("/api/demo/sample", json={}, headers=duress).status_code == 204

    assert len(client.get("/api/contacts", headers=duress).json()) == 3
    assert [c["name"] for c in client.get("/api/contacts", headers=real).json()] == [SMS["name"]]
    assert client.get("/api/zones", headers=real).json()["zones"] == []
    assert client.get("/api/sos/history", headers=duress).json() == []
    # No sample history is invented on the real side by a forced tap.
    assert [item["trigger"] for item in client.get("/api/sos/history", headers=real).json()] == ["duress"]


def test_sample_data_needs_a_session(client, demo):
    assert client.post("/api/demo/sample", json={}).status_code == 401
    assert client.post("/api/demo/sample", json={}, headers=demo).status_code == 401
