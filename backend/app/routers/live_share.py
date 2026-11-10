from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import LiveShareSession, Profile
from ..schemas.live_share import LiveShareStarted, LiveShareStatus, TrailPoint, Viewer
from ..schemas.sos import SosContext, StreamReply
from ..security import SessionCtx, StreamCtx, create_stream_token, current_session, stream_session
from ..services.live_share import (
    active_share,
    add_point,
    end_share,
    ensure_share,
    is_active,
    share_id_from_token,
    share_url,
    trail,
)
from ..services.sos import dispatch_sos, emergency_contacts, record_sos
from ..utils.time import iso_z

router = APIRouter(prefix="/api/live-share", tags=["live-share"])

_PAGE = Path(__file__).resolve().parent.parent / "templates" / "share_map.html"

# The token is the only credential, so it must not leak from the page or be stored by anything.
_PRIVATE_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "origin",
    "X-Robots-Tag": "noindex, nofollow",
}

# The survivor's own screen needs the recent trail, not the whole of a long share.
_OWN_TRAIL_POINTS = 300


def _status(db: Session, session: SessionCtx, share: LiveShareSession | None) -> dict:
    # Listed whether or not a share is running, so the survivor can see who would be told before starting one.
    viewers = [
        Viewer(name=c.name, relationship=c.relationship)
        for c in emergency_contacts(db, session.user_id, decoy=session.duress)
    ]
    if share is None:
        return {"active": False, "viewers": viewers}
    return {
        "active": True,
        "started_at": share.created_at,
        "expires_at": share.expires_at,
        "share_url": share_url(share.id),
        "points": [
            TrailPoint(lat=p.lat, lng=p.lng, accuracy=p.accuracy, at=p.created_at)
            for p in trail(db, share, _OWN_TRAIL_POINTS)
        ],
        "viewers": viewers,
    }


@router.get("", response_model=LiveShareStatus)
def live_share_status(
    session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> LiveShareStatus:
    """A duress session only ever learns about its own decoy share, never the real one."""
    return LiveShareStatus(**_status(db, session, active_share(db, session.user_id, decoy=session.duress)))


@router.post("", response_model=LiveShareStarted)
def start_live_share(
    body: SosContext,
    background: BackgroundTasks,
    session: SessionCtx = Depends(current_session),
    db: Session = Depends(get_db),
) -> LiveShareStarted:
    """Survivor-started sharing, without the wording of an SOS.

    Real session: opens a share and tells the emergency contacts. Duress session: opens a decoy
    share that nobody is told about. Either way the device is handed the stream token of the
    real share if one is running, so a forced tap here can't redirect or stop the real trail.
    """
    location = body.location.model_dump() if body.location else None

    if session.duress:
        share, _ = ensure_share(db, session.user_id, None, decoy=True)
        real = active_share(db, session.user_id)
        if real and location:
            add_point(db, real, location)
        stream_token = create_stream_token(real.id, real.expires_at) if real else None
        return LiveShareStarted(**_status(db, session, share), stream_token=stream_token)

    share = active_share(db, session.user_id)
    if share is None:
        payload = body.model_dump(mode="json", exclude_none=True)
        event = record_sos(db, session.user_id, trigger="share", payload=payload)
        share = active_share(db, session.user_id)
        background.add_task(dispatch_sos, event.id, "share")
    if location:
        add_point(db, share, location)
    return LiveShareStarted(
        **_status(db, session, share), stream_token=create_stream_token(share.id, share.expires_at)
    )


@router.post("/stop", status_code=status.HTTP_204_NO_CONTENT)
def stop_live_share(
    background: BackgroundTasks,
    session: SessionCtx = Depends(current_session),
    db: Session = Depends(get_db),
) -> Response:
    """The "I'm safe" action: ends sharing and tells contacts.

    Under duress it ends only the decoy share. A forced "I'm safe" must never cancel a real SOS.
    """
    share = active_share(db, session.user_id, decoy=session.duress)
    if share:
        end_share(db, share)
        if not session.duress and share.sos_event_id:
            background.add_task(dispatch_sos, share.sos_event_id, "safe")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/location", response_model=StreamReply)
def live_location(
    body: SosContext, stream: StreamCtx = Depends(stream_session), db: Session = Depends(get_db)
) -> StreamReply:
    share = db.get(LiveShareSession, stream.share_id)
    if share is None or not is_active(share):
        return StreamReply(stream=False)
    if body.location is not None:
        add_point(db, share, body.location.model_dump())
    return StreamReply(stream=True)


def _share_or_404(token: str, db: Session) -> LiveShareSession:
    share_id = share_id_from_token(token)
    share = db.get(LiveShareSession, share_id) if share_id else None
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found", headers=_PRIVATE_HEADERS)
    return share


@router.get("/{token}", response_class=HTMLResponse, include_in_schema=False)
def share_page(token: str) -> HTMLResponse:
    # Same page for any token: whether a link is valid is only learned from its data.
    return HTMLResponse(_PAGE.read_text(encoding="utf-8"), headers=_PRIVATE_HEADERS)


@router.get("/{token}/data", include_in_schema=False)
def share_data(token: str, response: Response, db: Session = Depends(get_db)) -> dict:
    """Everything a contact can learn from a link: one share's trail, and only while it is live."""
    share = _share_or_404(token, db)
    response.headers.update(_PRIVATE_HEADERS)
    # Once a share is over the link only says so. No location leaves through it again.
    if share.ended_at is not None:
        return {"status": "safe"}
    if not is_active(share):
        return {"status": "expired"}

    profile = db.get(Profile, share.user_id)
    name = (profile.decoy_alert_name if share.decoy else profile.alert_name) if profile else ""
    return {
        "status": "active",
        "name": name,
        "started_at": iso_z(share.created_at),
        "expires_at": iso_z(share.expires_at),
        "points": [
            {"lat": p.lat, "lng": p.lng, "accuracy": p.accuracy, "at": iso_z(p.created_at)} for p in trail(db, share)
        ],
    }

