"""Safe and danger zones. Screens see only their own side, like contacts, but the geofence watcher
on the device must always follow the real zones, so every reply also carries an opaque watch list.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Zone
from ..schemas.zones import WatchZone, ZoneBody, ZoneList, ZoneOut
from ..security import SCOPE_GEOFENCE, SessionCtx, create_offline_token, current_session

router = APIRouter(prefix="/api/zones", tags=["zones"])


def _reply(db: Session, session: SessionCtx) -> ZoneList:
    mine = db.scalars(
        select(Zone).where(Zone.user_id == session.user_id, Zone.decoy.is_(session.duress)).order_by(Zone.created_at)
    ).all()
    watched = db.scalars(
        select(Zone)
        .where(Zone.user_id == session.user_id, Zone.decoy.is_(False), Zone.enabled.is_(True))
        .order_by(Zone.created_at)
    ).all()
    watched = [z for z in watched if z.on_enter or z.on_exit]
    return ZoneList(
        zones=[ZoneOut.model_validate(z) for z in mine],
        watch=[
            WatchZone(i=z.id, a=z.lat, o=z.lng, r=z.radius, k="d" if z.kind == "danger" else "s", e=z.on_enter, x=z.on_exit)
            for z in watched
        ],
        watch_token=create_offline_token(session.user_id, SCOPE_GEOFENCE) if watched else None,
    )


def _owned(db: Session, session: SessionCtx, zone_id: str) -> Zone:
    zone = db.get(Zone, zone_id)
    if zone is None or zone.user_id != session.user_id or zone.decoy != session.duress:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    return zone


@router.get("", response_model=ZoneList)
def list_zones(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> ZoneList:
    return _reply(db, session)


@router.post("", response_model=ZoneList, status_code=status.HTTP_201_CREATED)
def create_zone(
    body: ZoneBody, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> ZoneList:
    db.add(Zone(user_id=session.user_id, decoy=session.duress, **body.resolved()))
    db.commit()
    return _reply(db, session)


@router.put("/{zone_id}", response_model=ZoneList)
def update_zone(
    zone_id: str, body: ZoneBody, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> ZoneList:
    zone = _owned(db, session, zone_id)
    for field, value in body.resolved().items():
        setattr(zone, field, value)
    db.commit()
    return _reply(db, session)


@router.delete("/{zone_id}", response_model=ZoneList)
def delete_zone(
    zone_id: str, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> ZoneList:
    db.delete(_owned(db, session, zone_id))
    db.commit()
    return _reply(db, session)
