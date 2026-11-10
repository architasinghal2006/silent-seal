import uuid

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import NotificationRecord, OfflineQueueEvent, SosEvent

from conftest import unlock

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
CLIP = {"iv": IV, "ciphertext": B64, "wrapped_key": B64}
LONG_AGO = "2026-01-01T10:00:00Z"


@pytest.fixture()
def tokens(client):
    r = client.post("/api/auth/setup", json={"real_pin": "1234", "duress_pin": "9876"})
    assert r.status_code == 201
    return r.json()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _event(kind, payload=None, timestamp=None, event_id=None):
    return {"id": event_id or uuid.uuid4().hex, "type": kind, "timestamp": timestamp, "payload": payload or {}}


def _sync(client, token, *events):
    return client.post("/api/offline/sync", json={"events": list(events)}, headers=_bearer(token))


def _statuses(reply):
    return [r["status"] for r in reply.json()["results"]]


def _events(user_id):
    with SessionLocal() as db:
        return db.scalars(select(SosEvent).where(SosEvent.user_id == user_id).order_by(SosEvent.created_at)).all()


def _bodies(user_id):
    with SessionLocal() as db:
        return db.scalars(
            select(NotificationRecord.body)
            .join(SosEvent, NotificationRecord.sos_event_id == SosEvent.id)
            .where(SosEvent.user_id == user_id)
        ).all()


def test_setup_gives_two_tokens_that_look_alike(tokens):
    assert tokens["offline_real"] != tokens["offline_duress"]
    assert abs(len(tokens["offline_real"]) - len(tokens["offline_duress"])) < 8


def test_offline_tokens_are_not_session_tokens(client, tokens):
    token = _bearer(tokens["offline_real"])
    assert client.get("/api/contacts", headers=token).status_code == 401
    assert client.post("/api/sos", json={}, headers=token).status_code == 401
    assert client.get("/api/vault/evidence", headers=token).status_code == 401
    assert client.get("/api/offline/status", headers=token).status_code == 401


def test_session_token_cannot_sync(client, tokens):
    real = unlock(client, tokens["user_id"], "1234")
    assert client.post("/api/offline/sync", json={"events": [_event("sos")]}, headers=real).status_code == 401
    assert client.post("/api/offline/sync", json={"events": [_event("sos")]}).status_code == 401


def test_queued_sos_alerts_contacts_with_delay_note_and_location(client, tokens):
    user = tokens["user_id"]
    client.post("/api/contacts", json=SMS, headers=unlock(client, user, "1234"))

    r = _sync(client, tokens["offline_real"], _event("sos", {"location": HERE, "battery": 0.5}, LONG_AGO))

    assert r.status_code == 200 and _statuses(r) == ["applied"]
    assert r.json()["stream"] is True and r.json()["stream_token"]
    body = _bodies(user)[0]
    assert "delayed" in body and "mlat=28.6139" in body and "/api/live-share/" in body


def test_recent_alert_has_no_delay_note(client, account):
    real = unlock(client, account, "1234")
    client.post("/api/contacts", json=SMS, headers=real)
    client.post("/api/sos", json={}, headers=real)
    assert "delayed" not in _bodies(account)[0]


def test_a_retried_event_takes_effect_once_and_is_counted(client, tokens):
    user = tokens["user_id"]
    real = unlock(client, user, "1234")
    client.post("/api/contacts", json=SMS, headers=real)
    event = _event("sos", timestamp=LONG_AGO)

    assert _statuses(_sync(client, tokens["offline_real"], event)) == ["applied"]
    assert _statuses(_sync(client, tokens["offline_real"], event)) == ["duplicate"]
    assert _statuses(_sync(client, tokens["offline_real"], event)) == ["duplicate"]

    assert len(_events(user)) == 1 and len(_bodies(user)) == 1
    status = client.get("/api/offline/status", headers=real).json()
    assert status["applied"] == 1 and status["duplicates"] == 2 and status["last_sync_at"]


def test_a_batch_is_applied_in_order_with_a_result_per_event(client, tokens):
    user = tokens["user_id"]
    real = unlock(client, user, "1234")
    client.put("/api/vault/meta", json=META, headers=real)
    repeat = _event("sos")

    r = _sync(
        client,
        tokens["offline_real"],
        repeat,
        _event("evidence", CLIP),
        repeat,
        _event("sos", {"battery": 7}),  # out of range
        _event("unlock", {"location": HERE}),
    )

    assert _statuses(r) == ["applied", "applied", "duplicate", "rejected", "applied"]
    assert [x["id"] for x in r.json()["results"]][0] == repeat["id"]
    assert len(_events(user)) == 1
    assert len(client.get("/api/vault/clips", headers=real).json()) == 1


def test_one_users_event_id_does_not_block_another_users(client, tokens):
    other = client.post("/api/auth/setup", json={"real_pin": "4321", "duress_pin": "8765"}).json()
    event = _event("sos")
    assert _statuses(_sync(client, tokens["offline_real"], event)) == ["applied"]
    assert _statuses(_sync(client, other["offline_real"], event)) == ["applied"]


def test_offline_real_unlock_is_discarded_and_its_location_never_stored(client, tokens):
    user = tokens["user_id"]
    r = _sync(client, tokens["offline_real"], _event("unlock", {"location": HERE}))
    assert _statuses(r) == ["applied"]
    assert r.json()["stream"] is False and r.json()["stream_token"] is None
    assert _events(user) == []


def test_offline_duress_unlock_fires_the_sos_and_answers_like_a_real_one(client, tokens):
    user = tokens["user_id"]
    client.post("/api/contacts", json=SMS, headers=unlock(client, user, "1234"))
    real_event, duress_event = _event("unlock", {"location": HERE}, LONG_AGO), _event("unlock", {"location": HERE}, LONG_AGO)

    real_reply = _sync(client, tokens["offline_real"], real_event)
    duress_reply = _sync(client, tokens["offline_duress"], duress_event)

    # The device sees the same result for both and cannot tell which token it held.
    assert _statuses(real_reply) == _statuses(duress_reply) == ["applied"]
    assert set(real_reply.json()) == set(duress_reply.json())
    assert [e.trigger for e in _events(user)] == ["duress"]
    body = _bodies(user)[0]
    assert "duress PIN" in body and "delayed" in body and "mlat=28.6139" in body

    # A retry looks the same for both too, and never alerts twice.
    assert _statuses(_sync(client, tokens["offline_real"], real_event)) == ["duplicate"]
    assert _statuses(_sync(client, tokens["offline_duress"], duress_event)) == ["duplicate"]
    assert len(_events(user)) == 1


def test_offline_evidence_joins_the_real_side_only(client, tokens):
    user = tokens["user_id"]
    real = unlock(client, user, "1234")
    client.put("/api/vault/meta", json=META, headers=real)

    assert _statuses(_sync(client, tokens["offline_real"], _event("evidence", CLIP))) == ["applied"]
    assert len(client.get("/api/vault/clips", headers=real).json()) == 1

    # Sent with the duress token it is accepted the same way, and dropped.
    assert _statuses(_sync(client, tokens["offline_duress"], _event("evidence", CLIP))) == ["applied"]
    assert len(client.get("/api/vault/clips", headers=real).json()) == 1
    assert client.get("/api/vault/clips", headers=unlock(client, user, "9876")).json() == []


def test_queued_evidence_is_stored_as_ciphertext(client, tokens):
    user = tokens["user_id"]
    real = unlock(client, user, "1234")
    client.put("/api/vault/meta", json=META, headers=real)
    _sync(client, tokens["offline_real"], _event("evidence", CLIP))
    clip = client.get("/api/vault/clips", headers=real).json()[0]
    assert {k: clip[k] for k in CLIP} == CLIP

    assert _statuses(_sync(client, tokens["offline_real"], _event("evidence", {**CLIP, "ciphertext": "plain text!"}))) == ["rejected"]


def test_malformed_requests_are_refused_whole(client, tokens):
    headers = _bearer(tokens["offline_real"])
    assert client.post("/api/offline/sync", json={"events": []}, headers=headers).status_code == 422
    assert client.post("/api/offline/sync", json={"events": [{"id": "short", "type": "sos"}]}, headers=headers).status_code == 422
    assert client.post("/api/offline/sync", json={"events": [_event("party")]}, headers=headers).status_code == 422
    too_many = [_event("sos") for _ in range(51)]
    assert client.post("/api/offline/sync", json={"events": too_many}, headers=headers).status_code == 422


def test_restored_device_can_get_a_token_for_its_session(client, tokens):
    real = unlock(client, tokens["user_id"], "1234")
    token = client.get("/api/offline/token", headers=real).json()["token"]
    assert _statuses(_sync(client, token, _event("sos"))) == ["applied"]


def test_duress_session_sees_an_empty_sync_status(client, tokens):
    user = tokens["user_id"]
    _sync(client, tokens["offline_real"], _event("sos"))
    assert client.get("/api/offline/status", headers=unlock(client, user, "1234")).json()["applied"] == 1
    assert client.get("/api/offline/status", headers=unlock(client, user, "9876")).json() == {
        "last_sync_at": None,
        "applied": 0,
        "duplicates": 0,
    }


def test_receipts_record_type_and_time_but_no_payload(client, tokens):
    _sync(client, tokens["offline_real"], _event("sos", {"location": HERE}, LONG_AGO))
    with SessionLocal() as db:
        receipt = db.scalars(select(OfflineQueueEvent).where(OfflineQueueEvent.user_id == tokens["user_id"])).one()
    assert receipt.event_type == "sos" and receipt.client_ts.year == 2026 and receipt.duplicates == 0
    assert "location" not in {c.name for c in OfflineQueueEvent.__table__.columns}
