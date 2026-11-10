from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import (
    AuditEvent,
    AuthCredential,
    Contact,
    EvidenceChainEntry,
    EvidenceClip,
    EvidenceItem,
    LiveShareSession,
    LocationPoint,
    NotificationRecord,
    OfflineQueueEvent,
    Profile,
    SosEvent,
    User,
    VaultMeta,
    Zone,
)
from . import audit

# Tables where each row belongs to either the real side or the decoy side of an account.
_SIDED_TABLES = (EvidenceChainEntry, EvidenceClip, EvidenceItem, VaultMeta, Contact, Zone)


def erase_decoy_side(db: Session, user_id: str) -> None:
    """All a duress session can erase. The real evidence, contacts and live share are out of its reach."""
    decoy_shares = select(LiveShareSession.id).where(
        LiveShareSession.user_id == user_id, LiveShareSession.decoy.is_(True)
    )
    db.execute(delete(LocationPoint).where(LocationPoint.share_id.in_(decoy_shares)))
    db.execute(delete(LiveShareSession).where(LiveShareSession.user_id == user_id, LiveShareSession.decoy.is_(True)))
    for table in _SIDED_TABLES:
        db.execute(delete(table).where(table.user_id == user_id, table.decoy.is_(True)))
    profile = db.get(Profile, user_id)
    if profile:
        profile.decoy_alert_name = ""
    audit.record(db, audit.DECOY_SIDE_ERASED, user_id)
    db.commit()


def erase_account(db: Session, user_id: str) -> None:
    """Deletes every row for the user. Explicit because SQLite doesn't enforce cascades by default."""
    share_ids = select(LiveShareSession.id).where(LiveShareSession.user_id == user_id)
    event_ids = select(SosEvent.id).where(SosEvent.user_id == user_id)
    db.execute(delete(LocationPoint).where(LocationPoint.share_id.in_(share_ids)))
    db.execute(delete(NotificationRecord).where(NotificationRecord.sos_event_id.in_(event_ids)))
    db.execute(delete(LiveShareSession).where(LiveShareSession.user_id == user_id))
    db.execute(delete(SosEvent).where(SosEvent.user_id == user_id))
    for table in (*_SIDED_TABLES, Profile, OfflineQueueEvent, AuditEvent, AuthCredential):
        db.execute(delete(table).where(table.user_id == user_id))
    db.execute(delete(User).where(User.id == user_id))
    db.commit()
