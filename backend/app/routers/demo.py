"""Received-alerts demo dashboard. Served by the API, not the PWA, so the decoy bundle never mentions it."""

import hmac
import json
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Delivery, SosEvent

router = APIRouter(prefix="/api/demo", include_in_schema=False)

_PAGE = Path(__file__).resolve().parent.parent / "demo_dashboard.html"


def _enabled() -> str:
    token = get_settings().demo_dashboard_token
    if not token:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    return token


@router.get("/dashboard", response_class=HTMLResponse)
def dashboard(_: str = Depends(_enabled)) -> str:
    return _PAGE.read_text(encoding="utf-8")


@router.get("/alerts")
def alerts(
    token: str = Depends(_enabled),
    x_demo_token: str = Header(default=""),
    db: Session = Depends(get_db),
) -> list[dict]:
    if not hmac.compare_digest(x_demo_token.encode(), token.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    events = db.scalars(select(SosEvent).order_by(SosEvent.created_at.desc()).limit(50)).all()
    return [
        {
            "id": event.id,
            "created_at": event.created_at.isoformat() + "Z",
            "trigger": event.trigger,
            "status": event.status,
            "payload": json.loads(event.payload) if event.payload else {},
            "deliveries": [
                {
                    "contact_name": d.contact_name,
                    "channel": d.channel,
                    "destination": d.destination,
                    "kind": d.kind,
                    "adapter": d.adapter,
                    "status": d.status,
                    "detail": d.detail,
                    "body": d.body,
                }
                for d in db.scalars(
                    select(Delivery).where(Delivery.sos_event_id == event.id).order_by(Delivery.created_at)
                ).all()
            ],
        }
        for event in events
    ]
