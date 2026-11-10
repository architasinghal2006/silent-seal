"""Cross-cutting protections: who may call what, session ending, throttling, headers, and what must never leak."""

import json

import jwt
import pytest
from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.main import app
from app.middleware import rate_limit
from app.models import AuditEvent, Contact

from conftest import unlock

# Routes anyone may call. Everything else under /api must refuse a caller with no session.
PUBLIC = {
    "/api/health",
    "/api/auth/setup",
    "/api/auth/unlock",
}
# Not in the schema, and public by design: the share link (the link is the credential), the
# demo tools (404 unless enabled, covered in test_demo.py) and static assets.


def _protected_routes():
    """Every documented route, read from the API's own schema so a new router can't be missed."""
    for path, operations in app.openapi()["paths"].items():
        if path in PUBLIC:
            continue
        for method in operations:
            yield method.upper(), path


def test_the_route_list_is_not_empty():
    routes = list(_protected_routes())
    assert len(routes) > 25
    assert ("POST", "/api/sos") in routes and ("GET", "/api/vault/export") in routes


@pytest.mark.parametrize("method,path", sorted(set(_protected_routes())))
def test_every_private_route_refuses_a_caller_without_a_session(client, method, path):
    url = path.replace("{contact_id}", "x").replace("{zone_id}", "x").replace("{clip_id}", "x").replace("{event_id}", "x")
    assert client.request(method, url, json={}).status_code == 401
    assert client.request(method, url, json={}, headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def test_a_forged_token_is_refused(client, account):
    forged = jwt.encode({"sub": account, "scp": "a", "jti": "x" * 32, "exp": 4102444800}, "wrong-secret", algorithm="HS256")
    assert client.get("/api/contacts", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    unsigned = jwt.encode({"sub": account, "scp": "a", "jti": "x" * 32}, "", algorithm="none")
    assert client.get("/api/contacts", headers={"Authorization": f"Bearer {unsigned}"}).status_code == 401


def test_the_user_is_taken_from_the_token_never_from_the_request(client, account, real):
    other = client.post("/api/auth/setup", json={"real_pin": "4321", "duress_pin": "8765"}).json()["user_id"]
    body = {"name": "Asha", "phone": "+919800000001", "channel": "sms", "user_id": other, "decoy": True}

    created = client.post("/api/contacts", json=body, headers=real).json()

    with SessionLocal() as db:
        stored = db.get(Contact, created["id"])
    assert stored.user_id == account and stored.decoy is False
    assert client.get("/api/contacts", headers=unlock(client, other, "4321")).json() == []


# ---------- real and duress unlocks look the same from outside ----------


def test_both_pins_get_an_equivalent_response(client, account):
    real = client.post("/api/auth/unlock", json={"user_id": account, "pin": "1234"})
    duress = client.post("/api/auth/unlock", json={"user_id": account, "pin": "9876"})

    assert real.status_code == duress.status_code == 200
    assert set(real.json()) == set(duress.json()) == {"token", "expires_in"}
    assert real.json()["expires_in"] == duress.json()["expires_in"]
    assert len(real.json()["token"]) == len(duress.json()["token"])
    assert set(real.headers) == set(duress.headers)

    real_claims = jwt.decode(real.json()["token"], options={"verify_signature": False})
    duress_claims = jwt.decode(duress.json()["token"], options={"verify_signature": False})
    assert set(real_claims) == set(duress_claims)
    assert "duress" not in json.dumps(duress_claims).lower()
    assert "duress" not in duress.text.lower()


def test_the_audit_trail_does_not_say_which_pin_was_used(client, account):
    unlock(client, account, "1234")
    unlock(client, account, "9876")
    with SessionLocal() as db:
        kinds = db.scalars(select(AuditEvent.kind).where(AuditEvent.user_id == account).order_by(AuditEvent.created_at)).all()
    assert kinds.count("unlock") == 2
    assert not any("duress" in kind or "decoy" in kind for kind in kinds)


def test_failures_and_lockouts_are_audited(client, account):
    for _ in range(3):
        client.post("/api/auth/unlock", json={"user_id": account, "pin": "0000"})
    with SessionLocal() as db:
        kinds = db.scalars(select(AuditEvent.kind).where(AuditEvent.user_id == account)).all()
    assert kinds.count("unlock_failed") == 3 and kinds.count("lockout") == 1


def test_lockout_ends_after_its_window(client, account, monkeypatch):
    for _ in range(3):
        client.post("/api/auth/unlock", json={"user_id": account, "pin": "0000"})
    assert client.post("/api/auth/unlock", json={"user_id": account, "pin": "1234"}).status_code == 401

    from datetime import timedelta

    from app.models import AuthCredential
    from app.utils.time import utcnow

    with SessionLocal() as db:
        db.get(AuthCredential, account).locked_until = utcnow() - timedelta(seconds=1)
        db.commit()
    assert client.post("/api/auth/unlock", json={"user_id": account, "pin": "1234"}).status_code == 200


def test_a_wrong_pin_between_right_ones_does_not_accumulate(client, account):
    for _ in range(2):
        client.post("/api/auth/unlock", json={"user_id": account, "pin": "0000"})
    unlock(client, account, "1234")  # resets the count
    for _ in range(2):
        client.post("/api/auth/unlock", json={"user_id": account, "pin": "0000"})
    assert client.post("/api/auth/unlock", json={"user_id": account, "pin": "1234"}).status_code == 200


def test_pins_are_stored_only_as_scrypt_hashes(client, account):
    from app.models import AuthCredential

    with SessionLocal() as db:
        credential = db.get(AuthCredential, account)
    for stored in (credential.real_pin_hash, credential.duress_pin_hash):
        assert stored.startswith("scrypt$") and "1234" not in stored and "9876" not in stored
    assert credential.real_pin_hash != credential.duress_pin_hash


# ---------- logout ----------


def test_logout_ends_that_session_only(client, account):
    first, second = unlock(client, account, "1234"), unlock(client, account, "1234")
    assert client.get("/api/me", headers=first).status_code == 200

    assert client.post("/api/auth/logout", headers=first).status_code == 204

    assert client.get("/api/me", headers=first).status_code == 401
    assert client.post("/api/sos", json={}, headers=first).status_code == 401
    assert client.post("/api/auth/logout", headers=first).status_code == 401
    assert client.get("/api/me", headers=second).status_code == 200


def test_logout_looks_the_same_for_a_duress_session(client, account):
    real, duress = unlock(client, account, "1234"), unlock(client, account, "9876")
    a, b = client.post("/api/auth/logout", headers=real), client.post("/api/auth/logout", headers=duress)
    assert a.status_code == b.status_code == 204 and a.content == b.content == b""
    assert client.get("/api/me", headers=duress).status_code == 401


# ---------- throttling ----------


def test_unlock_attempts_are_rate_limited_per_client(client, account, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_auth", 3)
    rate_limit.reset()  # creating the account already used one request
    replies = [client.post("/api/auth/unlock", json={"user_id": account, "pin": "1234"}) for _ in range(4)]

    assert [r.status_code for r in replies] == [200, 200, 200, 429]
    assert replies[3].json() == {"detail": "too many requests"} and replies[3].headers["retry-after"] == "60"
    # Other parts of the API have their own allowance.
    assert client.get("/api/health").status_code == 200
    token = {"Authorization": f"Bearer {replies[0].json()['token']}"}
    assert client.get("/api/contacts", headers=token).status_code == 200


def test_share_link_guessing_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_share_link", 2)
    codes = [client.get(f"/api/live-share/{'0' * 64}/data").status_code for _ in range(3)]
    assert codes == [404, 404, 429]


def test_a_limit_of_zero_turns_throttling_off(client, account, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_auth", 0)
    assert all(client.post("/api/auth/unlock", json={"user_id": account, "pin": "1234"}).status_code == 200 for _ in range(5))


# ---------- headers and errors ----------


def test_security_headers_are_on_every_response(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_auth", 1)
    client.post("/api/auth/unlock", json={"user_id": "x", "pin": "1"})
    limited = client.post("/api/auth/unlock", json={"user_id": "x", "pin": "1"})
    assert limited.status_code == 429

    for response in (client.get("/api/health"), client.get("/api/me"), limited):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
        assert "script-src 'self'" in response.headers["content-security-policy"]
        assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/health").headers["referrer-policy"] == "no-referrer"


def test_cors_allows_only_the_configured_origin(client):
    allowed = client.options(
        "/api/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"}
    )
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    stranger = client.options(
        "/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}
    )
    assert "access-control-allow-origin" not in stranger.headers


def test_a_rejected_request_never_echoes_what_was_sent(client):
    r = client.post("/api/auth/setup", json={"real_pin": "12ab", "duress_pin": "secret-looking-value"})
    assert r.status_code == 422
    assert r.json() == {"detail": "invalid request", "fields": ["duress_pin", "real_pin"]}
    assert "12ab" not in r.text and "secret-looking-value" not in r.text
