import json
import logging

from sqlalchemy.orm import Session

from ..models import SosEvent

log = logging.getLogger("silentseal.sos")


def record_sos(db: Session, account_id: str, trigger: str, payload: dict | None = None) -> SosEvent:
    """Persist a silent SOS. Dispatch to trusted contacts is wired in Phase B."""
    event = SosEvent(
        account_id=account_id,
        trigger=trigger,
        payload=json.dumps(payload) if payload is not None else None,
    )
    db.add(event)
    db.commit()
    log.warning("SOS queued: event=%s account=%s trigger=%s", event.id, account_id, trigger)
    return event
