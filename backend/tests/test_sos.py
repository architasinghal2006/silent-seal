import json

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Delivery, SosEvent
from app.notifications.adapters import Notification, SmsStubAdapter, SmtpStubAdapter

SMS = {"name": "Asha (dummy)", "phone": "+919800000001", "channel": "sms"}
EMAIL = {"name": "Ravi (dummy)", "email": "ravi@example.com", "channel": "email"}
LOCATION = {"lat": 28.6139, "lng": 77.209, "accuracy": 12.0}


def _auth(client, account, pin):
    r = client.post("/api/auth/unlock", json={"account_id": account, "pin": pin})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def real(client, account):
    return _auth(client, account, "1234")


def _events(account):
    with SessionLocal() as db:
        return db.scalars(select(SosEvent).where(SosEvent.account_id == account).order_by(SosEvent.created_at)).all()


def _deliveries(event_id):
    with SessionLocal() as db:
        return db.scalars(select(Delivery).where(Delivery.sos_event_id == event_id).order_by(Delivery.created_at)).all()


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
    other = client.post("/api/auth/setup", json={"real_pin": "4321", "duress_pin": "8765"}).json()["account_id"]
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

    assert client.post("/api/sos/context", json={"location": LOCATION, "battery": 0.5}, headers=duress).status_code == 204
    after = _deliveries(event.id)
    assert [d.kind for d in after] == ["initial", "update"]
    assert "mlat=28.6139" in after[1].body

    # A later context does not re-alert or overwrite.
    client.post("/api/sos/context", json={"location": {"lat": 1, "lng": 1}}, headers=duress)
    assert len(_deliveries(event.id)) == 2


def test_real_unlock_context_is_discarded(client, account, real):
    assert client.post("/api/sos/context", json={"location": LOCATION}, headers=real).status_code == 204
    assert _events(account) == []


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


def test_stub_adapters_never_report_sent():
    settings = get_settings().model_copy(
        update={"sms_provider": "msg91", "msg91_auth_key": "dummy", "smtp_host": "h", "smtp_user": "u", "smtp_password": "p"}
    )
    assert SmsStubAdapter(settings).send(Notification("sms", "+91", "x")).status == "stub"
    assert SmtpStubAdapter(settings).send(Notification("email", "a@b.c", "x")).status == "stub"
    unconfigured = get_settings().model_copy(update={"sms_provider": "", "smtp_host": ""})
    assert SmsStubAdapter(unconfigured).send(Notification("sms", "+91", "x")).status == "failed"
    assert SmtpStubAdapter(unconfigured).send(Notification("email", "a@b.c", "x")).status == "failed"
    assert SmsStubAdapter(settings).send(Notification("email", "a@b.c", "x")).status == "failed"


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
