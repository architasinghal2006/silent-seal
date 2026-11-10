"""Who is calling. Every router takes its identity from here, never from the request body."""

from dataclasses import dataclass
from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RevokedToken, User
from .tokens import OFFLINE_AUDIENCE, SCOPE_DURESS, STREAM_AUDIENCE, decode_token

_bearer = HTTPBearer(auto_error=False)


def _unauthorized() -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")


@dataclass(frozen=True)
class SessionCtx:
    user_id: str
    duress: bool
    jti: str
    expires_at: datetime


@dataclass(frozen=True)
class StreamCtx:
    share_id: str


@dataclass(frozen=True)
class OfflineCtx:
    user_id: str
    scope: str


def _claims(creds: HTTPAuthorizationCredentials | None, audience: str | None = None) -> dict:
    if creds is None:
        raise _unauthorized()
    try:
        return decode_token(creds.credentials, audience)
    except jwt.PyJWTError:
        raise _unauthorized()


def current_session(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> SessionCtx:
    data = _claims(creds)
    jti = data.get("jti", "")
    # Session tokens always carry an id. Offline and stream tokens never do, so they can't be used here.
    if not jti or data.get("aud") or db.get(RevokedToken, jti) is not None:
        raise _unauthorized()
    return SessionCtx(
        user_id=data["sub"],
        duress=data.get("scp") == SCOPE_DURESS,
        jti=jti,
        expires_at=datetime.fromtimestamp(data["exp"], timezone.utc).replace(tzinfo=None),
    )


def stream_session(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> StreamCtx:
    return StreamCtx(share_id=_claims(creds, STREAM_AUDIENCE)["sub"])


def offline_session(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> OfflineCtx:
    data = _claims(creds, OFFLINE_AUDIENCE)
    # These tokens last a long time, so they must stop working once an account is erased.
    if db.get(User, data["sub"]) is None:
        raise _unauthorized()
    return OfflineCtx(user_id=data["sub"], scope=data["scp"])
