"""A minimal trail of security-relevant actions.

Kinds are deliberately coarse. "unlock" covers both PINs: the trail must never be a way to
learn which one was used. No request content, location or contact detail is ever stored.
"""

from sqlalchemy.orm import Session

from ..models import AuditEvent

ACCOUNT_CREATED = "account_created"
UNLOCK = "unlock"
UNLOCK_FAILED = "unlock_failed"
LOCKOUT = "lockout"
LOGOUT = "logout"
SOS_CREATED = "sos_created"
SHARE_STARTED = "share_started"
SHARE_ENDED = "share_ended"
EVIDENCE_ADDED = "evidence_added"
OFFLINE_SYNC = "offline_sync"
DECOY_SIDE_ERASED = "side_erased"


def record(db: Session, kind: str, user_id: str | None = None) -> None:
    """Adds to the caller's transaction. The caller commits."""
    db.add(AuditEvent(user_id=user_id, kind=kind))
