import json

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.models import LiveShareSession, LocationPoint, NotificationRecord, SosEvent
from app.services.notifications import EmailAdapter, Notification, SmsAdapter

SMS = {"name": "Asha (dummy)", "phone": "+919800000001", "channel": "sms"}
EMAIL = {"name": "Ravi (dummy)", "email": "ravi@example.com", "channel": "email"}
LOCATION = {"lat": 28.6139, "lng": 77.209, "accuracy": 12.0}


def _auth(client, account, pin):
    r = client.post("/api/auth/unlock", json={"user_id": account, "pin": pin})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def real(client, account):
    return _auth(client, account, "1234")


def _events(account):
    with SessionLocal() as db:
        return db.scalars(select(SosEvent).where(SosEvent.user_id == account).order_by(SosEvent.created_at)).all()


def _deliveries(event_id):
    with SessionLocal() as db:
        return db.scalars(select(NotificationRecord).where(NotificationRecord.sos_event_id == event_id).order_by(NotificationRecord.created_at)).all()


def test_contact_crud(client, real):
    created = client.post("/api/contacts", json=SMS, headers=real)
    assert created.status_code == 201
    cid = created.json()["id"]
    assert [c["id"] for c in client.get("/api/contacts", headers=real).json()] == [cid]

    updated = client.put(f"/api/contacts/{cid}", json={**SMS, "name": "Asha D"}, headers=real)
    assert updated.json()["name"] == "Asha D"

    assert client.delete(f"/api/contacts/{cid}", headers=real).status_code == 204
    assert client.get("/api/contacts", headers=real).json() == []


@pytest.mark.parametrize(
    "bad",
    [
        {"name": "x", "channel": "sms"},
        {"name": "x", "channel": "email", "phone": "+919800000001"},
        {"name": "x", "channel": "sms", "phone": "not-a-phone"},
        {"name": "x", "channel": "email", "email": "nope"},
        {"name": "", "channel": "sms", "phone": "+919800000001"},
    ],
)
def test_contact_validation(client, real, bad):
    assert client.post("/api/contacts", json=bad, headers=real).status_code == 422


def test_contacts_are_isolated_between_accounts(client, real):
    cid = client.post("/api/contacts", json=SMS, headers=real).json()["id"]
    other = client.post("/api/auth/setup", json={"real_pin": "4321", "duress_pin": "8765"}).json()["user_id"]
    theirs = _auth(client, other, "4321")
    assert client.get("/api/contacts", headers=theirs).json() == []
    assert client.delete(f"/api/contacts/{cid}", headers=theirs).status_code == 404


def test_manual_sos_reaches_every_contact_with_capture(client, account, real):
    client.post("/api/contacts", json=SMS, headers=real)
    client.post("/api/contacts", json=EMAIL, headers=real)
    client.put("/api/profile", json={"alert_name": "Meera"}, headers=real)

    r = client.post(
        "/api/sos",
        json={"client_ts": "2026-11-03T10:00:00Z", "battery": 0.42, "location": LOCATION},
        headers=real,
    )
    assert r.status_code == 202

    event = _events(account)[-1]
    assert event.status == "dispatched"
    assert json.loads(event.payload)["client_ts"].startswith("2026-11-03T10:00:00")

    deliveries = _deliveries(event.id)
    assert {d.destination for d in deliveries} == {SMS["phone"], EMAIL["email"]}
    assert all(d.status == "sent" and d.adapter == "mock" for d in deliveries)
    body = deliveries[0].body
    assert "Meera" in body and "mlat=28.6139" in body and "42%" in body
    assert "Do NOT call" in body and "112" in body


def test_sos_without_contacts_is_recorded_as_reaching_nobody(client, account, real):
    client.post("/api/sos", json={}, headers=real)
    assert _events(account)[-1].status == "no_contacts"
    history = client.get("/api/sos/history", headers=real).json()
    assert history[0]["status"] == "no_contacts"


def test_client_cannot_claim_duress_trigger(client, real):
    assert client.post("/api/sos", json={"trigger": "duress"}, headers=real).status_code == 422


def test_sos_requires_token(client):
    assert client.post("/api/sos", json={}).status_code == 401


def test_duress_alerts_real_contacts_then_adds_location(client, account, real):
    client.post("/api/contacts", json=SMS, headers=real)
    duress = _auth(client, account, "9876")

    event = _events(account)[-1]
    assert event.trigger == "duress" and event.status == "dispatched"
    first = _deliveries(event.id)
    assert len(first) == 1 and "duress PIN" in first[0].body

    assert client.post("/api/sos/context", json={"location": LOCATION, "battery": 0.5}, headers=duress).status_code == 200
    after = _deliveries(event.id)
    assert [d.kind for d in after] == ["initial", "update"]
    assert "mlat=28.6139" in after[1].body

    # A later context does not re-alert or overwrite.
    client.post("/api/sos/context", json={"location": {"lat": 1, "lng": 1}}, headers=duress)
    assert len(_deliveries(event.id)) == 2


def test_real_unlock_context_is_discarded(client, account, real):
    r = client.post("/api/sos/context", json={"location": LOCATION}, headers=real)
    assert r.json() == {"stream": False, "stream_token": None}
    assert _events(account) == []
    with SessionLocal() as db:
        assert db.scalars(select(LocationPoint).join(LiveShareSession).where(LiveShareSession.user_id == account)).first() is None


def test_duress_session_sees_nothing_and_cannot_touch_real_data(client, account, real):
    cid = client.post("/api/contacts", json=SMS, headers=real).json()["id"]
    client.put("/api/profile", json={"alert_name": "Meera"}, headers=real)
    client.post("/api/sos", json={}, headers=real)
    duress = _auth(client, account, "9876")

    assert client.get("/api/contacts", headers=duress).json() == []
    assert client.get("/api/profile", headers=duress).json() == {"alert_name": ""}
    assert client.get("/api/sos/history", headers=duress).json() == []
    assert client.delete(f"/api/contacts/{cid}", headers=duress).status_code == 404
    assert client.put(f"/api/contacts/{cid}", json=EMAIL, headers=duress).status_code == 404
    client.put("/api/profile", json={"alert_name": "Changed"}, headers=duress)
    assert client.get("/api/profile", headers=real).json() == {"alert_name": "Meera"}


def test_contact_added_under_duress_is_a_decoy_that_never_gets_alerts(client, account, real):
    client.post("/api/contacts", json=SMS, headers=real)
    duress = _auth(client, account, "9876")

    decoy = {"name": "Forced", "phone": "+919800000099", "channel": "sms"}
    assert client.post("/api/contacts", json=decoy, headers=duress).status_code == 201
    assert [c["name"] for c in client.get("/api/contacts", headers=duress).json()] == ["Forced"]
    assert [c["name"] for c in client.get("/api/contacts", headers=real).json()] == [SMS["name"]]

    client.post("/api/sos", json={}, headers=duress)
    assert {d.destination for d in _deliveries(_events(account)[-1].id)} == {SMS["phone"]}


def test_demo_dashboard_requires_token(client, real, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "demo_dashboard_token", "")
    assert client.get("/api/demo/dashboard").status_code == 404
    assert client.get("/api/demo/alerts").status_code == 404

    monkeypatch.setattr(settings, "demo_dashboard_token", "demo-token")
    assert client.get("/api/demo/dashboard").status_code == 200
    assert client.get("/api/demo/alerts", headers={"X-Demo-Token": "wrong"}).status_code == 401
    client.post("/api/contacts", json=SMS, headers=real)
    client.post("/api/sos", json={}, headers=real)
    alerts = client.get("/api/demo/alerts", headers={"X-Demo-Token": "demo-token"}).json()
    assert any(a["deliveries"] for a in alerts)


# ---------- contact details and emergency designation ----------


def test_contact_keeps_relationship_and_emergency_flag(client, real):
    body = {**SMS, "relationship": "Sister", "is_emergency": False}
    created = client.post("/api/contacts", json=body, headers=real).json()
    assert (created["relationship"], created["is_emergency"]) == ("Sister", False)

    updated = client.put(f"/api/contacts/{created['id']}", json={**body, "is_emergency": True}, headers=real).json()
    assert updated["is_emergency"] is True
    assert client.get("/api/contacts", headers=real).json()[0]["relationship"] == "Sister"


def test_a_new_contact_is_an_emergency_contact_unless_told_otherwise(client, real):
    created = client.post("/api/contacts", json=SMS, headers=real).json()
    assert created["is_emergency"] is True and created["relationship"] == ""


def test_sos_goes_only_to_emergency_contacts(client, account, real):
    client.post("/api/contacts", json=SMS, headers=real)
    client.post("/api/contacts", json={**EMAIL, "is_emergency": False}, headers=real)

    client.post("/api/sos", json={}, headers=real)

    assert {d.destination for d in _deliveries(_events(account)[-1].id)} == {SMS["phone"]}


def test_sos_with_only_non_emergency_contacts_reaches_nobody(client, account, real):
    client.post("/api/contacts", json={**SMS, "is_emergency": False}, headers=real)
    client.post("/api/sos", json={}, headers=real)
    event = _events(account)[-1]
    assert event.status == "no_contacts" and _deliveries(event.id) == []


# ---------- the status of one alert ----------


def test_status_confirms_each_step_only_once_it_happened(client, account, real):
    client.post("/api/contacts", json=SMS, headers=real)
    accepted = client.post("/api/sos", json={"battery": 0.3}, headers=real)
    assert accepted.status_code == 202 and accepted.json()["accepted"] is True
    event_id = accepted.json()["event_id"]

    before = client.get(f"/api/sos/{event_id}", headers=real).json()
    assert before["status"] == "dispatched" and before["location_captured"] is False
    assert before["battery"] == 0.3 and before["live_share_active"] is True
    assert before["deliveries"] == [
        {"contact_name": SMS["name"], "channel": "sms", "adapter": "mock", "status": "sent", "kind": "initial"}
    ]

    client.post("/api/sos/context", json={"location": LOCATION}, headers=real)
    assert client.get(f"/api/sos/{event_id}", headers=real).json()["location_captured"] is True


def test_status_reports_stub_adapters_as_not_sent(client, account, real, monkeypatch):
    monkeypatch.setattr(get_settings(), "notify_adapter", "sms")
    client.post("/api/contacts", json=SMS, headers=real)
    event_id = client.post("/api/sos", json={}, headers=real).json()["event_id"]

    status = client.get(f"/api/sos/{event_id}", headers=real).json()
    assert status["status"] == "undelivered"
    assert [(d["adapter"], d["status"]) for d in status["deliveries"]] == [("sms", "failed")]
    assert client.get("/api/sos/history", headers=real).json()[0]["delivered"] == 0


def test_status_under_duress_never_lists_the_real_contacts(client, account, real):
    client.post("/api/contacts", json=SMS, headers=real)
    duress = _auth(client, account, "9876")
    event_id = client.post("/api/sos", json={}, headers=duress).json()["event_id"]

    hidden = client.get(f"/api/sos/{event_id}", headers=duress).json()
    assert hidden["status"] == "no_contacts" and hidden["deliveries"] == [] and hidden["live_share_active"] is False
    # The real contact was alerted all the same, and the real session can see that.
    shown = client.get(f"/api/sos/{event_id}", headers=real).json()
    assert [d["contact_name"] for d in shown["deliveries"]] == [SMS["name"]]

    client.post("/api/contacts", json={"name": "Forced", "phone": "+919800000099", "channel": "sms"}, headers=duress)
    decoy = client.get(f"/api/sos/{event_id}", headers=duress).json()
    assert [(d["contact_name"], d["status"]) for d in decoy["deliveries"]] == [("Forced", "pending")]
    assert set(decoy) == set(shown)


def test_status_of_another_users_alert_is_not_found(client, real):
    event_id = client.post("/api/sos", json={}, headers=real).json()["event_id"]
    other = client.post("/api/auth/setup", json={"real_pin": "4321", "duress_pin": "8765"}).json()["user_id"]
    assert client.get(f"/api/sos/{event_id}", headers=_auth(client, other, "4321")).status_code == 404
    assert client.get("/api/sos/nope", headers=real).status_code == 404


def test_history_lists_alerts_newest_first_with_outcomes(client, account, real):
    client.post("/api/contacts", json=SMS, headers=real)
    client.post("/api/sos", json={}, headers=real)
    client.post("/api/live-share/stop", headers=real)
    client.post("/api/live-share", json={}, headers=real)

    history = client.get("/api/sos/history", headers=real).json()
    assert [(h["trigger"], h["delivered"], h["undelivered"], h["simulated"]) for h in history] == [
        ("share", 1, 0, False),
        ("manual", 1, 0, False),
    ]


# ---------- notification adapters ----------


def test_mock_adapter_records_without_logging_the_message(caplog):
    from app.services.notifications import MockNotificationAdapter, get_adapter

    adapter = get_adapter()
    assert isinstance(adapter, MockNotificationAdapter) and adapter.name == "mock"
    with caplog.at_level("INFO", logger="silentseal.notify"):
        result = adapter.send(Notification("sms", "+919800000001", "SILENT SOS from Meera at 28.6139"))
    assert result.status == "sent" and "nothing left this server" in result.detail
    assert "Meera" not in caplog.text and "28.6139" not in caplog.text and "+919800000001" not in caplog.text


def test_adapter_is_chosen_by_configuration(monkeypatch):
    from app.services.notifications import get_adapter

    monkeypatch.setattr(get_settings(), "notify_adapter", "sms")
    assert isinstance(get_adapter(), SmsAdapter)
    monkeypatch.setattr(get_settings(), "notify_adapter", "email")
    assert isinstance(get_adapter(), EmailAdapter)


def test_logs_never_say_an_unlock_was_under_duress(client, account, caplog):
    with caplog.at_level("DEBUG"):
        _auth(client, account, "9876")
    assert "duress" not in caplog.text.lower()
