import jwt
from sqlalchemy import select

from app.db import SessionLocal
from app.models import SosEvent


def _sos_count(account_id: str) -> int:
    with SessionLocal() as db:
        return len(db.scalars(select(SosEvent).where(SosEvent.account_id == account_id)).all())


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "db": "ok"}


def test_setup_rejects_identical_pins(client):
    r = client.post("/api/auth/setup", json={"real_pin": "1111", "duress_pin": "1111"})
    assert r.status_code == 422


def test_setup_rejects_non_numeric_pin(client):
    r = client.post("/api/auth/setup", json={"real_pin": "12ab", "duress_pin": "5678"})
    assert r.status_code == 422


def test_real_pin_unlocks_without_sos(client, account):
    r = client.post("/api/auth/unlock", json={"account_id": account, "pin": "1234"})
    assert r.status_code == 200
    token = r.json()["token"]
    assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert _sos_count(account) == 0


def test_duress_pin_unlocks_and_fires_silent_sos(client, account):
    r = client.post("/api/auth/unlock", json={"account_id": account, "pin": "9876"})
    assert r.status_code == 200
    body = r.json()
    # Response shape is identical to a real unlock.
    assert set(body) == {"token", "expires_in"}
    claims = jwt.decode(body["token"], options={"verify_signature": False})
    assert claims["scp"] == "b"
    assert _sos_count(account) == 1


def test_wrong_pin_denied(client, account):
    r = client.post("/api/auth/unlock", json={"account_id": account, "pin": "0000"})
    assert r.status_code == 401
    assert r.json() == {"detail": "invalid"}


def test_unknown_account_denied_same_as_wrong_pin(client):
    r = client.post("/api/auth/unlock", json={"account_id": "nope", "pin": "1234"})
    assert r.status_code == 401
    assert r.json() == {"detail": "invalid"}


def test_lockout_after_repeated_failures(client, account):
    for _ in range(3):
        client.post("/api/auth/unlock", json={"account_id": account, "pin": "0000"})
    # Even the correct PIN is refused while locked out.
    r = client.post("/api/auth/unlock", json={"account_id": account, "pin": "1234"})
    assert r.status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
