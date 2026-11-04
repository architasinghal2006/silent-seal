import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings

_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

# Opaque scope values so a token inspected on-device does not say "duress".
SCOPE_FULL = "a"
SCOPE_DURESS = "b"
SCOPE_GEOFENCE = "g"
_STREAM_AUDIENCE = "stream"
_OFFLINE_AUDIENCE = "offline"
_OFFLINE_TTL = timedelta(days=365)


def hash_pin(pin: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(pin.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        _, salt_hex, dk_hex = stored.split("$")
    except ValueError:
        return False
    dk = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(dk.hex(), dk_hex)


# Used to burn equal time when an account id is unknown.
DUMMY_HASH = hash_pin("000000")


@dataclass(frozen=True)
class SessionCtx:
    account_id: str
    duress: bool


@dataclass(frozen=True)
class StreamCtx:
    share_id: str


@dataclass(frozen=True)
class OfflineCtx:
    account_id: str
    scope: str


def create_token(account_id: str, duress: bool) -> tuple[str, int]:
    s = get_settings()
    ttl = s.jwt_ttl_minutes * 60
    now = datetime.now(timezone.utc)
    payload = {
        "sub": account_id,
        "scp": SCOPE_DURESS if duress else SCOPE_FULL,
        "iat": now,
        "exp": now + timedelta(seconds=ttl),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256"), ttl


def create_offline_token(account_id: str, scope: str) -> str:
    """Only for sending queued work. Long-lived because the phone may be offline when it's needed."""
    payload = {
        "sub": account_id,
        "scp": scope,
        "aud": _OFFLINE_AUDIENCE,
        "exp": datetime.now(timezone.utc) + _OFFLINE_TTL,
    }
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")


def create_stream_token(share_id: str, expires_at: datetime) -> str:
    """Only able to add points to one share, so it can safely outlive the session and the app lock."""
    payload = {"sub": share_id, "aud": _STREAM_AUDIENCE, "exp": expires_at.replace(tzinfo=timezone.utc)}
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")


_bearer = HTTPBearer(auto_error=False)


def current_session(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> SessionCtx:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    try:
        data = jwt.decode(creds.credentials, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    return SessionCtx(account_id=data["sub"], duress=data.get("scp") == SCOPE_DURESS)


def stream_session(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> StreamCtx:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    try:
        data = jwt.decode(
            creds.credentials, get_settings().jwt_secret, algorithms=["HS256"], audience=_STREAM_AUDIENCE
        )
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    return StreamCtx(share_id=data["sub"])


def offline_session(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> OfflineCtx:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    try:
        data = jwt.decode(
            creds.credentials, get_settings().jwt_secret, algorithms=["HS256"], audience=_OFFLINE_AUDIENCE
        )
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    return OfflineCtx(account_id=data["sub"], scope=data["scp"])
