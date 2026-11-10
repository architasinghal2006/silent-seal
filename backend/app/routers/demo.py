"""Judge dashboard and demo tools. Served by the API, not the PWA, so the calculator bundle never mentions them.

Every route here answers 404 unless DEMO_DASHBOARD_TOKEN is set. The dashboard's data routes
also need that token, because they show alerts from every account on this server. Never
enable this with real data.
"""

import hmac
import json
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Response, status
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import AuditEvent, LiveShareSession, LocationPoint, NotificationRecord, OfflineQueueEvent, Profile, SosEvent
from ..schemas.demo import DemoAccount, SampleRequest, SimulatedSos
from ..schemas.vault import VerifyRequest, VerifyResult
from ..security import SessionCtx, current_session
from ..services import demo_seed
from ..services.live_share import is_active, share_url
from ..services.notifications import delivers_externally
from ..services.sos import dispatch_sos
from ..utils.time import iso_z, utcnow
from .vault import verify_result

router = APIRouter(prefix="/api/demo", include_in_schema=False)

_PAGE = Path(__file__).resolve().parent.parent / "templates" / "judge_dashboard.html"


def _enabled() -> str:
    token = get_settings().demo_dashboard_token
    if not token:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    return token


def _judge(token: str = Depends(_enabled), x_demo_token: str = Header(default="")) -> None:
    if not hmac.compare_digest(x_demo_token.encode(), token.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")


def _share_for(db: Session, event: SosEvent) -> LiveShareSession | None:
    """The real share this alert opened, or the one already running that it joined."""
    opened = db.scalars(select(LiveShareSession).where(LiveShareSession.sos_event_id == event.id)).first()
    if opened is not None:
        return opened
    candidates = db.scalars(
        select(LiveShareSession)
        .where(
            LiveShareSession.user_id == event.user_id,
            LiveShareSession.decoy.is_(False),
            LiveShareSession.created_at <= event.created_at,
        )
        .order_by(LiveShareSession.created_at.desc())
    ).all()
    return next((s for s in candidates if s.ended_at is None or s.ended_at >= event.created_at), None)


def _share_view(db: Session, share: LiveShareSession | None) -> dict:
    if share is None:
        return {"status": "none"}
    points, last = db.execute(
        select(func.count(LocationPoint.id), func.max(LocationPoint.created_at)).where(LocationPoint.share_id == share.id)
    ).one()
    state = "safe" if share.ended_at else "active" if is_active(share) else "expired"
    return {
        "status": state,
        "url": share_url(share.id),
        "points": points,
        "last_point_at": iso_z(last),
        "expires_at": iso_z(share.expires_at),
        "ended_at": iso_z(share.ended_at),
    }


def _alerts(db: Session) -> list[dict]:
    events = db.scalars(select(SosEvent).order_by(SosEvent.created_at.desc()).limit(50)).all()
    alerts = []
    for event in events:
        profile = db.get(Profile, event.user_id)
        records = db.scalars(
            select(NotificationRecord)
            .where(NotificationRecord.sos_event_id == event.id)
            .order_by(NotificationRecord.created_at)
        ).all()
        alerts.append(
            {
                "id": event.id,
                "created_at": iso_z(event.created_at),
                "trigger": event.trigger,
                "status": event.status,
                "simulated": event.simulated,
                "sender": (profile.alert_name if profile else "") or f"Account {event.user_id[:6]}",
                "payload": json.loads(event.payload) if event.payload else {},
                "share": _share_view(db, _share_for(db, event)),
                "deliveries": [
                    {
                        "contact_name": r.contact_name,
                        "channel": r.channel,
                        "destination": r.destination,
                        "kind": r.kind,
                        "adapter": r.adapter,
                        "status": r.status,
                        "detail": r.detail,
                        "body": r.body,
                    }
                    for r in records
                ],
            }
        )
    return alerts


@router.get("/dashboard", response_class=HTMLResponse)
def dashboard(_: str = Depends(_enabled)) -> HTMLResponse:
    return HTMLResponse(_PAGE.read_text(encoding="utf-8"), headers={"Cache-Control": "no-store"})


@router.get("/alerts", dependencies=[Depends(_judge)])
def alerts(db: Session = Depends(get_db)) -> list[dict]:
    return _alerts(db)


@router.get("/state", dependencies=[Depends(_judge)])
def state(db: Session = Depends(get_db)) -> dict:
    """Everything the dashboard shows, in one poll. Also steps any simulated trail forward."""
    demo_seed.advance_simulations(db)
    settings = get_settings()
    queue = db.scalars(select(OfflineQueueEvent).order_by(OfflineQueueEvent.created_at.desc()).limit(25)).all()
    applied, duplicates = db.execute(
        select(func.count(OfflineQueueEvent.event_id), func.coalesce(func.sum(OfflineQueueEvent.duplicates), 0))
    ).one()
    trail = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(30)).all()
    return {
        "server_time": iso_z(utcnow()),
        "notifications": {
            "adapter": settings.notify_adapter,
            # True only when a real provider is selected and fully configured.
            "delivers_externally": delivers_externally(settings),
        },
        "alerts": _alerts(db),
        "offline": {
            "applied": applied,
            "duplicates_suppressed": duplicates,
            "events": [
                {
                    "id": e.event_id[:8],
                    "type": e.event_type,
                    "queued_at": iso_z(e.client_ts),
                    "received_at": iso_z(e.created_at),
                    "delay_seconds": round((e.created_at - e.client_ts).total_seconds()) if e.client_ts else None,
                    "duplicates": e.duplicates,
                }
                for e in queue
            ],
        },
        "audit": [{"kind": a.kind, "at": iso_z(a.created_at), "account": (a.user_id or "")[:6]} for a in trail],
    }


@router.post("/simulate-sos", response_model=SimulatedSos, dependencies=[Depends(_judge)])
def simulate_sos(background: BackgroundTasks, db: Session = Depends(get_db)) -> SimulatedSos:
    """A clearly labelled simulated alert, sent through the same dispatch path as a real one."""
    event = demo_seed.simulate_sos(db)
    background.add_task(dispatch_sos, event.id)
    share = _share_for(db, event)
    return SimulatedSos(event_id=event.id, share_url=share_url(share.id) if share else None)


@router.post("/seed", response_model=DemoAccount, status_code=status.HTTP_201_CREATED, dependencies=[Depends(_judge)])
def seed(db: Session = Depends(get_db)) -> DemoAccount:
    """A throwaway account with known PINs, for showing that both PINs get the same response."""
    user = demo_seed.create_demo_user(db, "Demo account", demo_seed.DEMO_REAL_PIN, demo_seed.DEMO_DURESS_PIN)
    return DemoAccount(user_id=user.id, real_pin=demo_seed.DEMO_REAL_PIN, duress_pin=demo_seed.DEMO_DURESS_PIN)


@router.post("/verify", response_model=VerifyResult, dependencies=[Depends(_judge)])
def verify(body: VerifyRequest) -> VerifyResult:
    return verify_result(body.bundle)


@router.post("/sample", status_code=status.HTTP_204_NO_CONTENT)
def sample(
    body: SampleRequest,
    _: str = Depends(_enabled),
    session: SessionCtx = Depends(current_session),
    db: Session = Depends(get_db),
) -> Response:
    """Fills the caller's own account with sample contacts, zones and history. Each session fills only its own side."""
    centre = (body.centre.lat, body.centre.lng) if body.centre else None
    demo_seed.add_sample_data(db, session.user_id, decoy=session.duress, centre=centre)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
