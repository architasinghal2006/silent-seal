import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import NotificationRecord, SosEvent
from ..schemas.sos import DeliveryStatus, SosAccepted, SosContext, SosHistoryItem, SosRequest, SosStatus, StreamReply
from ..security import SessionCtx, create_stream_token, current_session
from ..services.live_share import active_share, add_point
from ..services.sos import attach_context, dispatch_sos, emergency_contacts, record_sos

router = APIRouter(prefix="/api/sos", tags=["sos"])


@router.post("", response_model=SosAccepted, status_code=status.HTTP_202_ACCEPTED)
def fire_sos(
    body: SosRequest,
    background: BackgroundTasks,
    session: SessionCtx = Depends(current_session),
    db: Session = Depends(get_db),
) -> SosAccepted:
    """Alerts the real emergency contacts, whichever PIN opened this session."""
    payload = body.model_dump(mode="json", exclude_none=True, exclude={"trigger"})
    event = record_sos(db, session.user_id, trigger=body.trigger, payload=payload)
    background.add_task(dispatch_sos, event.id)
    return SosAccepted(accepted=True, event_id=event.id)


@router.post("/context", response_model=StreamReply)
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
    share = active_share(db, session.user_id)
    if body.location is not None:
        location = body.location.model_dump()
        event_id = attach_context(db, session.user_id, location, body.battery)
        if event_id:
            background.add_task(dispatch_sos, event_id, "update")
        if share:
            add_point(db, share, location)
    if share is None:
        return StreamReply(stream=False)
    return StreamReply(stream=True, stream_token=create_stream_token(share.id, share.expires_at))


@router.get("/history", response_model=list[SosHistoryItem])
def sos_history(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)):
    if session.duress:
        return []
    events = db.scalars(
        select(SosEvent).where(SosEvent.user_id == session.user_id).order_by(SosEvent.created_at.desc()).limit(10)
    ).all()
    items = []
    for event in events:
        statuses = db.scalars(
            select(NotificationRecord.status).where(
                NotificationRecord.sos_event_id == event.id, NotificationRecord.kind.in_(("initial", "share"))
            )
        ).all()
        delivered = sum(s == "sent" for s in statuses)
        items.append(
            SosHistoryItem(
                id=event.id,
                created_at=event.created_at,
                trigger=event.trigger,
                status=event.status,
                delivered=delivered,
                undelivered=len(statuses) - delivered,
                simulated=event.simulated,
            )
        )
    return items


@router.get("/{event_id}", response_model=SosStatus)
def sos_status(event_id: str, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)):
    """What happened to one alert, for the status screen.

    A duress session is shown its own side only: its decoy contacts, still waiting. The real
    contacts who were actually alerted are never listed to whoever forced the unlock.
    """
    event = db.get(SosEvent, event_id)
    if event is None or event.user_id != session.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    payload = json.loads(event.payload) if event.payload else {}
    common = {
        "id": event.id,
        "created_at": event.created_at,
        "trigger": "manual" if session.duress else event.trigger,
        "location_captured": "location" in payload,
        "battery": payload.get("battery"),
    }

    if session.duress:
        decoys = emergency_contacts(db, session.user_id, decoy=True)
        return SosStatus(
            **common,
            status="queued" if decoys else "no_contacts",
            deliveries=[
                DeliveryStatus(contact_name=c.name, channel=c.channel, adapter="", status="pending", kind="initial")
                for c in decoys
            ],
            live_share_active=active_share(db, session.user_id, decoy=True) is not None,
        )

    records = db.scalars(
        select(NotificationRecord)
        .where(NotificationRecord.sos_event_id == event.id, NotificationRecord.kind.in_(("initial", "share")))
        .order_by(NotificationRecord.created_at)
    ).all()
    return SosStatus(
        **common,
        status=event.status,
        deliveries=[
            DeliveryStatus(contact_name=r.contact_name, channel=r.channel, adapter=r.adapter, status=r.status, kind=r.kind)
            for r in records
        ],
        live_share_active=active_share(db, session.user_id) is not None,
    )
