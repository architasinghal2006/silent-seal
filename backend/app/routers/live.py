from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Breadcrumb, LiveShare, Profile
from ..schemas import LiveStatus, SosContext, StreamReply
from ..security import StreamCtx, SessionCtx, current_session, stream_session
from ..services.live import active_share, add_point, end_share, is_active, share_id_from_token
from ..services.sos import dispatch_sos

router = APIRouter(prefix="/api", tags=["live"])

_PAGE = Path(__file__).resolve().parent.parent / "share_map.html"

# The token is the only credential, so it must not leak from the page or be stored by anything.
_PRIVATE_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "origin",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
}


@router.get("/live/status", response_model=LiveStatus)
def live_status(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> LiveStatus:
    if session.duress:
        return LiveStatus(active=False)
    share = active_share(db, session.account_id)
    return LiveStatus(active=share is not None, expires_at=share.expires_at if share else None)


@router.post("/live/safe", status_code=status.HTTP_204_NO_CONTENT)
def im_safe(
    background: BackgroundTasks,
    session: SessionCtx = Depends(current_session),
    db: Session = Depends(get_db),
) -> Response:
    """Ends sharing and tells contacts. Does nothing under duress: a forced "I'm safe" must not cancel an SOS."""
    if not session.duress:
        share = active_share(db, session.account_id)
        if share:
            end_share(db, share)
            background.add_task(dispatch_sos, share.sos_event_id, "safe")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/live/point", response_model=StreamReply)
def live_point(
    body: SosContext, stream: StreamCtx = Depends(stream_session), db: Session = Depends(get_db)
) -> StreamReply:
    share = db.get(LiveShare, stream.share_id)
    if share is None or not is_active(share):
        return StreamReply(stream=False)
    if body.location is not None:
        add_point(db, share, body.location.model_dump())
    return StreamReply(stream=True)


def _share_or_404(token: str, db: Session) -> LiveShare:
    share_id = share_id_from_token(token)
    share = db.get(LiveShare, share_id) if share_id else None
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found", headers=_PRIVATE_HEADERS)
    return share


@router.get("/share/{token}", response_class=HTMLResponse, include_in_schema=False)
def share_page(token: str) -> HTMLResponse:
    # Same page for any token: whether a link is valid is only learned from its data.
    return HTMLResponse(_PAGE.read_text(encoding="utf-8"), headers=_PRIVATE_HEADERS)


@router.get("/share/{token}/data", include_in_schema=False)
def share_data(token: str, response: Response, db: Session = Depends(get_db)) -> dict:
    share = _share_or_404(token, db)
    response.headers.update(_PRIVATE_HEADERS)
    # Once a share is over the link only says so. No location leaves through it again.
    if share.ended_at is not None:
        return {"status": "safe"}
    if not is_active(share):
        return {"status": "expired"}

    profile = db.get(Profile, share.account_id)
    points = db.scalars(
        select(Breadcrumb)
        .where(Breadcrumb.share_id == share.id)
        .order_by(Breadcrumb.created_at.desc(), Breadcrumb.id)
        .limit(1000)
    ).all()
    return {
        "status": "active",
        "name": profile.alert_name if profile else "",
        "expires_at": share.expires_at.isoformat() + "Z",
        "points": [
            {"lat": p.lat, "lng": p.lng, "accuracy": p.accuracy, "at": p.created_at.isoformat() + "Z"}
            for p in reversed(points)
        ],
    }
