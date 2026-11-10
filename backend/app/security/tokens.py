from datetime import datetime, timedelta, timezone

import jwt

from ..config import get_settings
from ..utils.time import new_id

# Opaque scope values so a token inspected on-device does not say which PIN made it.
SCOPE_FULL = "a"
SCOPE_DURESS = "b"
SCOPE_GEOFENCE = "g"
STREAM_AUDIENCE = "stream"
OFFLINE_AUDIENCE = "offline"
_OFFLINE_TTL = timedelta(days=365)
_ALGORITHM = "HS256"


def create_token(user_id: str, duress: bool) -> tuple[str, int]:
    s = get_settings()
    ttl = s.jwt_ttl_minutes * 60
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "scp": SCOPE_DURESS if duress else SCOPE_FULL,
        "jti": new_id(),
        "iat": now,
        "exp": now + timedelta(seconds=ttl),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=_ALGORITHM), ttl


def create_offline_token(user_id: str, scope: str) -> str:
    """Only for sending queued work. Long-lived because the phone may be offline when it's needed."""
    payload = {
        "sub": user_id,
        "scp": scope,
        "aud": OFFLINE_AUDIENCE,
        "exp": datetime.now(timezone.utc) + _OFFLINE_TTL,
    }
    return jwt.encode(payload, get_settings().jwt_secret, algorithm=_ALGORITHM)


def create_stream_token(share_id: str, expires_at: datetime) -> str:
    """Only able to add points to one share, so it can safely outlive the session and the app lock."""
    payload = {"sub": share_id, "aud": STREAM_AUDIENCE, "exp": expires_at.replace(tzinfo=timezone.utc)}
    return jwt.encode(payload, get_settings().jwt_secret, algorithm=_ALGORITHM)


def decode_token(token: str, audience: str | None = None) -> dict:
    """Raises jwt.PyJWTError for anything forged, expired or meant for a different purpose."""
    return jwt.decode(token, get_settings().jwt_secret, algorithms=[_ALGORITHM], audience=audience)
