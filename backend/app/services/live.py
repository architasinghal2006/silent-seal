import hashlib
import hmac
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Breadcrumb, LiveShare, utcnow

_ID_LENGTH = 32


def share_token(share_id: str) -> str:
    """The link token is derived, not stored, so a database leak alone does not expose live links."""
    secret = get_settings().jwt_secret.encode()
    signature = hmac.new(secret, f"share:{share_id}".encode(), hashlib.sha256).hexdigest()[:32]
    return share_id + signature


def share_id_from_token(token: str) -> str | None:
    share_id = token[:_ID_LENGTH]
    return share_id if hmac.compare_digest(share_token(share_id).encode(), token.encode()) else None


def share_url(share_id: str) -> str:
    return f"{get_settings().public_base_url.rstrip('/')}/api/share/{share_token(share_id)}"


def is_active(share: LiveShare) -> bool:
    return share.ended_at is None and share.expires_at > utcnow()


def active_share(db: Session, account_id: str) -> LiveShare | None:
    return db.scalars(
        select(LiveShare)
        .where(LiveShare.account_id == account_id, LiveShare.ended_at.is_(None), LiveShare.expires_at > utcnow())
        .order_by(LiveShare.created_at.desc())
    ).first()


def ensure_share(db: Session, account_id: str, sos_event_id: str) -> LiveShare:
    """A repeat SOS keeps the running share, so contacts never have two maps to watch."""
    share = active_share(db, account_id)
    if share is None:
        ttl = timedelta(minutes=get_settings().live_share_ttl_minutes)
        share = LiveShare(account_id=account_id, sos_event_id=sos_event_id, expires_at=utcnow() + ttl)
        db.add(share)
        db.commit()
    return share


def add_point(db: Session, share: LiveShare, location: dict) -> None:
    db.add(
        Breadcrumb(share_id=share.id, lat=location["lat"], lng=location["lng"], accuracy=location.get("accuracy"))
    )
    db.commit()


def end_share(db: Session, share: LiveShare) -> None:
    share.ended_at = utcnow()
    db.commit()
