"""Work a device queued while it had no connection, sent with its long-lived offline token.

The device cannot tell which PIN it was given, so it reports every offline unlock the same
way. Only here, from the token's scope, does a duress unlock become an SOS.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Account, OfflineReceipt, VaultClip, VaultMeta
from ..schemas import OfflineClip, OfflineSos, OfflineUnlocked, OfflineTokenReply, StreamReply
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
from ..services.live import active_share, add_point
from ..services.sos import dispatch_sos, record_sos

router = APIRouter(prefix="/api/offline", tags=["offline"])


def _known_account(ctx: OfflineCtx = Depends(offline_session), db: Session = Depends(get_db)) -> OfflineCtx:
    # These tokens last a long time, so they must stop working once an account is erased.
    if db.get(Account, ctx.account_id) is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    return ctx


def _first_time(db: Session, ctx: OfflineCtx, client_id: str) -> bool:
    """Queues retry after lost replies, so the same item must only ever take effect once."""
    db.add(OfflineReceipt(client_id=client_id, account_id=ctx.account_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    return True


def _stream_reply(db: Session, account_id: str) -> StreamReply:
    share = active_share(db, account_id)
    if share is None:
        return StreamReply(stream=False)
    return StreamReply(stream=True, stream_token=create_stream_token(share.id, share.expires_at))


def _payload(body, *fields: str) -> dict:
    return body.model_dump(mode="json", exclude_none=True, include=set(fields))


@router.post("/sos", response_model=StreamReply)
def queued_sos(
    body: OfflineSos,
    background: BackgroundTasks,
    ctx: OfflineCtx = Depends(_known_account),
    db: Session = Depends(get_db),
) -> StreamReply:
    # The geofence token sits unsealed on the phone, so it can only ever send zone alerts.
    if ctx.scope == SCOPE_GEOFENCE and body.trigger != "geofence":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "forbidden")
    if _first_time(db, ctx, body.client_id):
        payload = _payload(body, "client_ts", "battery", "location", "zone_event")
        event = record_sos(db, ctx.account_id, trigger=body.trigger, payload=payload)
        share = active_share(db, ctx.account_id)
        if share:
            for point in body.trail:
                add_point(db, share, point.model_dump())
            if body.location:
                add_point(db, share, body.location.model_dump())
        background.add_task(dispatch_sos, event.id)
    return _stream_reply(db, ctx.account_id)


@router.post("/unlocked", response_model=StreamReply)
def queued_unlock(
    body: OfflineUnlocked,
    background: BackgroundTasks,
    ctx: OfflineCtx = Depends(_known_account),
    db: Session = Depends(get_db),
) -> StreamReply:
    """Real unlock: discarded, and its location is never stored. Duress unlock: fires the SOS it couldn't send."""
    if ctx.scope not in (SCOPE_FULL, SCOPE_DURESS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "forbidden")
    if ctx.scope == SCOPE_DURESS and _first_time(db, ctx, body.client_id):
        event = record_sos(
            db, ctx.account_id, trigger="duress", payload=_payload(body, "client_ts", "battery", "location")
        )
        share = active_share(db, ctx.account_id)
        if share and body.location:
            add_point(db, share, body.location.model_dump())
        background.add_task(dispatch_sos, event.id)
    return _stream_reply(db, ctx.account_id)


@router.post("/clip", status_code=status.HTTP_201_CREATED)
def queued_clip(
    body: OfflineClip, ctx: OfflineCtx = Depends(_known_account), db: Session = Depends(get_db)
) -> dict[str, bool]:
    """Evidence sealed offline. Joins the chain next time the vault opens. Discarded under duress, as online."""
    if ctx.scope not in (SCOPE_FULL, SCOPE_DURESS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "forbidden")
    if ctx.scope == SCOPE_FULL and db.get(VaultMeta, (ctx.account_id, False)) and _first_time(db, ctx, body.client_id):
        db.add(
            VaultClip(
                account_id=ctx.account_id,
                decoy=False,
                iv=body.iv,
                ciphertext=body.ciphertext,
                wrapped_key=body.wrapped_key,
            )
        )
        db.commit()
    return {"accepted": True}


@router.get("/token", response_model=OfflineTokenReply)
def offline_token(session: SessionCtx = Depends(current_session)) -> OfflineTokenReply:
    """For a device restored with a recovery code, which never received tokens at setup."""
    scope = SCOPE_DURESS if session.duress else SCOPE_FULL
    return OfflineTokenReply(token=create_offline_token(session.account_id, scope))
