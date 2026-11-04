"""Safe and danger zones. Screens see only their own side, like contacts, but the geofence watcher
on the device must always follow the real zones, so every reply also carries an opaque watch list.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Zone
from ..schemas import WatchZone, ZoneBody, ZoneList, ZoneOut
from ..security import SCOPE_GEOFENCE, SessionCtx, create_offline_token, current_session

router = APIRouter(prefix="/api/zones", tags=["zones"])


def _reply(db: Session, session: SessionCtx) -> ZoneList:
    mine = db.scalars(
        select(Zone)
        .where(Zone.account_id == session.account_id, Zone.decoy.is_(session.duress))
        .order_by(Zone.created_at)
    ).all()
    real = db.scalars(select(Zone).where(Zone.account_id == session.account_id, Zone.decoy.is_(False))).all()
    return ZoneList(
        zones=[ZoneOut.model_validate(z) for z in mine],
        watch=[WatchZone(i=z.id, a=z.lat, o=z.lng, r=z.radius, k="d" if z.kind == "danger" else "s") for z in real],
        watch_token=create_offline_token(session.account_id, SCOPE_GEOFENCE) if real else None,
    )


@router.get("", response_model=ZoneList)
def list_zones(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> ZoneList:
    return _reply(db, session)


@router.post("", response_model=ZoneList, status_code=status.HTTP_201_CREATED)
def create_zone(
    body: ZoneBody, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> ZoneList:
    db.add(Zone(account_id=session.account_id, decoy=session.duress, **body.model_dump()))
    db.commit()
    return _reply(db, session)


@router.delete("/{zone_id}", response_model=ZoneList)
def delete_zone(
    zone_id: str, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> ZoneList | Response:
    zone = db.get(Zone, zone_id)
    if zone is None or zone.account_id != session.account_id or zone.decoy != session.duress:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    db.delete(zone)
    db.commit()
    return _reply(db, session)
