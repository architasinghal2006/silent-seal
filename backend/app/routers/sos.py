from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Delivery, SosEvent
from ..schemas import SosContext, SosHistoryItem, SosRequest, StreamReply
from ..security import SessionCtx, create_stream_token, current_session
from ..services.live import active_share, add_point
from ..services.sos import attach_context, dispatch_sos, record_sos

router = APIRouter(prefix="/api", tags=["sos"])


@router.post("/sos", status_code=status.HTTP_202_ACCEPTED)
def fire_sos(
    body: SosRequest,
    background: BackgroundTasks,
    session: SessionCtx = Depends(current_session),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    payload = body.model_dump(mode="json", exclude_none=True, exclude={"trigger"})
    event = record_sos(db, session.account_id, trigger=body.trigger, payload=payload)
    background.add_task(dispatch_sos, event.id)
    return {"accepted": True}


@router.post("/sos/context", response_model=StreamReply)
def sos_context(
    body: SosContext,
    background: BackgroundTasks,
    session: SessionCtx = Depends(current_session),
    db: Session = Depends(get_db),
) -> StreamReply:
    """The client sends this after every unlock, because it cannot tell real from duress.

    It is stored only if an SOS is in progress. Otherwise it is discarded, so a normal
    unlock leaves no location on the server. The reply says whether to keep streaming.
    """
    share = active_share(db, session.account_id)
    if body.location is not None:
        location = body.location.model_dump()
        event_id = attach_context(db, session.account_id, location, body.battery)
        if event_id:
            background.add_task(dispatch_sos, event_id, "update")
        if share:
            add_point(db, share, location)
    if share is None:
        return StreamReply(stream=False)
    return StreamReply(stream=True, stream_token=create_stream_token(share.id, share.expires_at))


@router.get("/sos/history", response_model=list[SosHistoryItem])
def sos_history(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)):
    if session.duress:
        return []
    events = db.scalars(
        select(SosEvent)
        .where(SosEvent.account_id == session.account_id)
        .order_by(SosEvent.created_at.desc())
        .limit(10)
    ).all()
    items = []
    for event in events:
        statuses = db.scalars(
            select(Delivery.status).where(Delivery.sos_event_id == event.id, Delivery.kind == "initial")
        ).all()
        delivered = sum(s == "sent" for s in statuses)
        items.append(
            SosHistoryItem(
                created_at=event.created_at,
                trigger=event.trigger,
                status=event.status,
                delivered=delivered,
                undelivered=len(statuses) - delivered,
            )
        )
    return items
