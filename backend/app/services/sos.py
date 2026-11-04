import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import Contact, Delivery, LiveShare, Profile, SosEvent, utcnow
from ..notifications.adapters import Notification, get_adapter
from .live import ensure_share, share_url

log = logging.getLogger("silentseal.sos")

IST = timezone(timedelta(hours=5, minutes=30), "IST")

# How long after an SOS a late location from the device is still attached to it.
CONTEXT_WINDOW = timedelta(minutes=10)

# Past this, contacts are told the alert was held up, so they don't assume it's happening now.
DELAY_NOTICE = timedelta(minutes=2)


def record_sos(db: Session, account_id: str, trigger: str, payload: dict | None = None) -> SosEvent:
    event = SosEvent(
        account_id=account_id,
        trigger=trigger,
        payload=json.dumps(payload) if payload else None,
    )
    db.add(event)
    db.commit()
    ensure_share(db, account_id, event.id)
    log.warning("SOS queued: event=%s account=%s trigger=%s", event.id, account_id, trigger)
    return event


def attach_context(db: Session, account_id: str, location: dict, battery: float | None) -> str | None:
    """Add a late location to a recent SOS still missing one. Returns its id, or None if there is none."""
    recent = db.scalars(
        select(SosEvent)
        .where(SosEvent.account_id == account_id, SosEvent.created_at >= utcnow() - CONTEXT_WINDOW)
        .order_by(SosEvent.created_at.desc())
    ).first()
    if recent is None:
        return None
    payload = json.loads(recent.payload) if recent.payload else {}
    if "location" in payload:
        return None
    payload["location"] = location
    if battery is not None:
        payload["battery"] = battery
    recent.payload = json.dumps(payload)
    db.commit()
    return recent.id


def _delayed_since(event: SosEvent, payload: dict) -> str | None:
    """When the phone tried to send this, if that was a while before it reached us."""
    raw = payload.get("client_ts")
    if not raw:
        return None
    sent = datetime.fromisoformat(raw)
    sent = sent if sent.tzinfo else sent.replace(tzinfo=timezone.utc)
    if event.created_at.replace(tzinfo=timezone.utc) - sent < DELAY_NOTICE:
        return None
    return sent.astimezone(IST).strftime("%d %b %H:%M IST")


def build_message(event: SosEvent, alert_name: str, kind: str, map_url: str | None = None) -> str:
    payload = json.loads(event.payload) if event.payload else {}
    who = alert_name or "Someone who listed you as a trusted contact"
    when = event.created_at.replace(tzinfo=timezone.utc).astimezone(IST).strftime("%d %b %H:%M IST")

    if kind == "safe":
        return f"{who} has marked themselves safe and ended location sharing. If you are still worried, check on them carefully."

    if kind == "update":
        lines = [f"Location update for the silent SOS from {who} ({when})."]
    else:
        lines = [f"SILENT SOS from {who} at {when}. They may need help."]
        zone_event = payload.get("zone_event")
        if zone_event:
            place = "entered an area they marked as dangerous" if zone_event == "entered" else "left an area they marked as safe"
            lines.append(f"Sent automatically: they {place}.")
        if event.trigger == "duress":
            lines.append("They used their duress PIN, so someone may be forcing them to unlock their phone.")
        lines.append("Do NOT call or text them: it may put them at risk.")
        delayed_since = _delayed_since(event, payload)
        if delayed_since:
            lines.append(f"This alert was delayed because their phone was offline. It was sent at {delayed_since}.")
        if map_url:
            lines.append(f"Live map, private to you: {map_url}")

    location = payload.get("location")
    if location:
        lat, lng = location["lat"], location["lng"]
        accuracy = f" (within {round(location['accuracy'])} m)" if location.get("accuracy") is not None else ""
        lines.append(f"Location{accuracy}: https://www.openstreetmap.org/?mlat={lat}&mlon={lng}#map=17/{lat}/{lng}")
    if payload.get("battery") is not None:
        lines.append(f"Phone battery: {round(payload['battery'] * 100)}%.")
    if kind != "update":
        lines.append("If they are in immediate danger, call 112.")
    return "\n".join(lines)


def dispatch_sos(event_id: str, kind: str = "initial") -> None:
    """Send an SOS to the account's real contacts. Runs after the response, so it never raises."""
    try:
        with SessionLocal() as db:
            _dispatch(db, event_id, kind)
    except Exception:
        log.exception("SOS dispatch failed: event=%s", event_id)


def _dispatch(db: Session, event_id: str, kind: str) -> None:
    event = db.get(SosEvent, event_id)
    if event is None:
        return
    contacts = db.scalars(
        select(Contact).where(Contact.account_id == event.account_id, Contact.decoy.is_(False))
    ).all()
    profile = db.get(Profile, event.account_id)
    share = db.scalars(select(LiveShare).where(LiveShare.account_id == event.account_id).order_by(LiveShare.created_at.desc())).first()
    body = build_message(event, profile.alert_name if profile else "", kind, share_url(share.id) if share else None)
    adapter = get_adapter()

    delivered = 0
    for contact in contacts:
        destination = contact.phone if contact.channel == "sms" else contact.email
        result = adapter.send(Notification(contact.channel, destination or "", body))
        delivered += result.status == "sent"
        db.add(
            Delivery(
                sos_event_id=event.id,
                contact_name=contact.name,
                channel=contact.channel,
                destination=destination or "",
                kind=kind,
                adapter=adapter.name,
                status=result.status,
                detail=result.detail,
                body=body,
            )
        )

    if kind == "initial" or (kind == "update" and delivered):
        event.status = "no_contacts" if not contacts else "dispatched" if delivered else "undelivered"
    db.commit()
