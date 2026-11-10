"""Work a device queued while it had no connection, sent with its long-lived offline token.

The device cannot tell which PIN it was given, so it reports every offline unlock the same
way. Only here, from the token's scope, does a duress unlock become an SOS. Every event is
answered the same way for either scope, so the replies can't be used to tell them apart.
"""

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import EvidenceClip, OfflineQueueEvent, VaultMeta
from ..schemas.offline_queue import (
    EvidencePayload,
    OfflineStatus,
    OfflineTokenReply,
    QueuedEvent,
    SosPayload,
    SyncReply,
    SyncRequest,
    SyncResult,
    UnlockPayload,
)
from ..security import (
    SCOPE_DURESS,
    SCOPE_FULL,
    SCOPE_GEOFENCE,
    OfflineCtx,
    SessionCtx,
    create_offline_token,
    create_stream_token,
    current_session,
    offline_session,
)
from ..services import audit
from ..services.live_share import active_share, add_point
from ..services.sos import dispatch_sos, record_sos

router = APIRouter(prefix="/api/offline", tags=["offline"])

_PAYLOADS = {"sos": SosPayload, "unlock": UnlockPayload, "evidence": EvidencePayload}


def _first_time(db: Session, ctx: OfflineCtx, event: QueuedEvent) -> bool:
    """Queues retry after lost replies, so the same event must only ever take effect once."""
    client_ts = event.timestamp.replace(tzinfo=None) if event.timestamp else None
    db.add(OfflineQueueEvent(user_id=ctx.user_id, event_id=event.id, event_type=event.type, client_ts=client_ts))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        seen = db.get(OfflineQueueEvent, (ctx.user_id, event.id))
        if seen is not None:
            seen.duplicates += 1
            db.commit()
        return False
    return True


def _allowed(scope: str, event: QueuedEvent, payload) -> bool:
    # The geofence token sits unsealed on the phone, so it can only ever send zone alerts.
    if scope == SCOPE_GEOFENCE:
        return event.type == "sos" and payload.trigger == "geofence"
    return scope in (SCOPE_FULL, SCOPE_DURESS)


def _sos_payload(event: QueuedEvent, payload, *fields: str) -> dict:
    data = payload.model_dump(mode="json", exclude_none=True, include=set(fields))
    if event.timestamp:
        data["client_ts"] = event.timestamp.isoformat()
    return data


def _apply(db: Session, ctx: OfflineCtx, event: QueuedEvent, payload, background: BackgroundTasks) -> None:
    if event.type == "sos":
        data = _sos_payload(event, payload, "battery", "location", "zone_event", "zone_kind")
        sos = record_sos(db, ctx.user_id, trigger=payload.trigger, payload=data)
        share = active_share(db, ctx.user_id)
        if share:
            for point in payload.trail:
                add_point(db, share, point.model_dump())
            if payload.location:
                add_point(db, share, payload.location.model_dump())
        background.add_task(dispatch_sos, sos.id)

    elif event.type == "unlock":
        # Real unlock: discarded, and its location is never stored. Duress: fires the SOS it couldn't send.
        if ctx.scope == SCOPE_DURESS:
            sos = record_sos(
                db, ctx.user_id, trigger="duress", payload=_sos_payload(event, payload, "battery", "location")
            )
            share = active_share(db, ctx.user_id)
            if share and payload.location:
                add_point(db, share, payload.location.model_dump())
            background.add_task(dispatch_sos, sos.id)

    elif event.type == "evidence":
        # Evidence sealed offline joins the chain next time the vault opens. Discarded under duress, as online.
        if ctx.scope == SCOPE_FULL and db.get(VaultMeta, (ctx.user_id, False)):
            db.add(
                EvidenceClip(
                    user_id=ctx.user_id,
                    decoy=False,
                    iv=payload.iv,
                    ciphertext=payload.ciphertext,
                    wrapped_key=payload.wrapped_key,
                )
            )
            db.commit()


@router.post("/sync", response_model=SyncReply)
def sync(
    body: SyncRequest,
    background: BackgroundTasks,
    ctx: OfflineCtx = Depends(offline_session),
    db: Session = Depends(get_db),
) -> SyncReply:
    """Applies queued events in order. Safe to send again: an event id only ever takes effect once."""
    results: list[SyncResult] = []
    for event in body.events:
        try:
            payload = _PAYLOADS[event.type].model_validate(event.payload)
        except ValidationError:
            results.append(SyncResult(id=event.id, status="rejected"))
            continue
        if not _allowed(ctx.scope, event, payload):
            results.append(SyncResult(id=event.id, status="rejected"))
            continue
        if not _first_time(db, ctx, event):
            results.append(SyncResult(id=event.id, status="duplicate"))
            continue
        _apply(db, ctx, event, payload, background)
        results.append(SyncResult(id=event.id, status="applied"))

    audit.record(db, audit.OFFLINE_SYNC, ctx.user_id)
    db.commit()
    share = active_share(db, ctx.user_id)
    if share is None:
        return SyncReply(results=results, stream=False)
    return SyncReply(results=results, stream=True, stream_token=create_stream_token(share.id, share.expires_at))


@router.get("/status", response_model=OfflineStatus)
def offline_status(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> OfflineStatus:
    """What the server has received from this account's queues. Always empty for a duress session."""
    if session.duress:
        return OfflineStatus()
    applied, duplicates, last = db.execute(
        select(
            func.count(OfflineQueueEvent.event_id),
            func.coalesce(func.sum(OfflineQueueEvent.duplicates), 0),
            func.max(OfflineQueueEvent.created_at),
        ).where(OfflineQueueEvent.user_id == session.user_id)
    ).one()
    return OfflineStatus(last_sync_at=last, applied=applied, duplicates=duplicates)


@router.get("/token", response_model=OfflineTokenReply)
def offline_token(session: SessionCtx = Depends(current_session)) -> OfflineTokenReply:
    """For a device restored with a recovery code, which never received tokens at setup."""
    scope = SCOPE_DURESS if session.duress else SCOPE_FULL
    return OfflineTokenReply(token=create_offline_token(session.user_id, scope))
