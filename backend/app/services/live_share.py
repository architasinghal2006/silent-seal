import hashlib
import hmac
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import LiveShareSession, LocationPoint
from ..utils.time import utcnow
from . import audit

_ID_LENGTH = 32


def share_token(share_id: str) -> str:
    """The link token is derived, not stored, so a database leak alone does not expose live links.

    128 random bits of id plus 128 bits of HMAC: it cannot be guessed, and an id alone is useless.
    """
    secret = get_settings().jwt_secret.encode()
    signature = hmac.new(secret, f"share:{share_id}".encode(), hashlib.sha256).hexdigest()[:32]
    return share_id + signature


def share_id_from_token(token: str) -> str | None:
    share_id = token[:_ID_LENGTH]
    return share_id if hmac.compare_digest(share_token(share_id).encode(), token.encode()) else None


def share_url(share_id: str) -> str:
    return f"{get_settings().public_base_url.rstrip('/')}/api/live-share/{share_token(share_id)}"


def is_active(share: LiveShareSession) -> bool:
    return share.ended_at is None and share.expires_at > utcnow()


def active_share(db: Session, user_id: str, decoy: bool = False) -> LiveShareSession | None:
    return db.scalars(
        select(LiveShareSession)
        .where(
            LiveShareSession.user_id == user_id,
            LiveShareSession.decoy.is_(decoy),
            LiveShareSession.ended_at.is_(None),
            LiveShareSession.expires_at > utcnow(),
        )
        .order_by(LiveShareSession.created_at.desc())
    ).first()


def ensure_share(
    db: Session, user_id: str, sos_event_id: str | None, decoy: bool = False
) -> tuple[LiveShareSession, bool]:
    """A repeat SOS keeps the running share, so contacts never have two maps to watch.

    Returns the share and whether it was just created.
    """
    share = active_share(db, user_id, decoy)
    if share is not None:
        return share, False
    ttl = timedelta(minutes=get_settings().live_share_ttl_minutes)
    share = LiveShareSession(user_id=user_id, sos_event_id=sos_event_id, decoy=decoy, expires_at=utcnow() + ttl)
    db.add(share)
    if not decoy:
        audit.record(db, audit.SHARE_STARTED, user_id)
    db.commit()
    return share, True


def add_point(db: Session, share: LiveShareSession, location: dict) -> None:
    db.add(
        LocationPoint(share_id=share.id, lat=location["lat"], lng=location["lng"], accuracy=location.get("accuracy"))
    )
    db.commit()


def trail(db: Session, share: LiveShareSession, limit: int = 1000) -> list[LocationPoint]:
    """The newest points of one share, oldest first. Never reaches into any other share."""
    points = db.scalars(
        select(LocationPoint)
        .where(LocationPoint.share_id == share.id)
        .order_by(LocationPoint.created_at.desc(), LocationPoint.id)
        .limit(limit)
    ).all()
    return list(reversed(points))


def end_share(db: Session, share: LiveShareSession) -> None:
    share.ended_at = utcnow()
    if not share.decoy:
        audit.record(db, audit.SHARE_ENDED, share.user_id)
    db.commit()
