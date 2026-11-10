import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import Contact, LiveShareSession, NotificationRecord, Profile, SosEvent
from ..utils.time import IST, utcnow
from . import audit
from .live_share import ensure_share, share_url
from .notifications import Notification, get_adapter

log = logging.getLogger("silentseal.sos")

# How long after an SOS a late location from the device is still attached to it.
CONTEXT_WINDOW = timedelta(minutes=10)

# Past this, contacts are told the alert was held up, so they don't assume it's happening now.
DELAY_NOTICE = timedelta(minutes=2)

_ZONE_SENTENCES = {
    ("danger", "entered"): "entered an area they marked as dangerous",
    ("danger", "left"): "left an area they marked as dangerous",
    ("safe", "entered"): "arrived at a place they marked as safe",
    ("safe", "left"): "left an area they marked as safe",
}


def record_sos(
    db: Session, user_id: str, trigger: str, payload: dict | None = None, simulated: bool = False
) -> SosEvent:
    event = SosEvent(
        user_id=user_id,
        trigger=trigger,
        payload=json.dumps(payload) if payload else None,
        simulated=simulated,
    )
    db.add(event)
    audit.record(db, audit.SOS_CREATED, user_id)
    db.commit()
    ensure_share(db, user_id, event.id)
    # Ids only: no trigger, so the log never says an unlock was made under duress.
    log.info("sos recorded: event=%s", event.id)
    return event


def attach_context(db: Session, user_id: str, location: dict, battery: float | None) -> str | None:
    """Add a late location to a recent SOS still missing one. Returns its id, or None if there is none."""
    recent = db.scalars(
        select(SosEvent)
        .where(SosEvent.user_id == user_id, SosEvent.created_at >= utcnow() - CONTEXT_WINDOW)
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


def _zone_sentence(payload: dict) -> str | None:
    zone_event = payload.get("zone_event")
    if not zone_event:
        return None
    # Older devices send no zone type: entering then meant a danger zone, leaving a safe one.
    kind = payload.get("zone_kind") or ("danger" if zone_event == "entered" else "safe")
    return _ZONE_SENTENCES.get((kind, zone_event))


def build_message(event: SosEvent, alert_name: str, kind: str, map_url: str | None = None) -> str:
    payload = json.loads(event.payload) if event.payload else {}
    who = alert_name or "Someone who listed you as a trusted contact"
    when = event.created_at.replace(tzinfo=timezone.utc).astimezone(IST).strftime("%d %b %H:%M IST")

    if kind == "safe":
        return f"{who} has marked themselves safe and ended location sharing. If you are still worried, check on them carefully."

    if kind == "update":
        lines = [f"Location update for the silent SOS from {who} ({when})."]
    elif event.trigger == "share":
        lines = [f"{who} is sharing their live location with you ({when})."]
        lines.append("Do NOT call or text them unless they ask: it may put them at risk.")
        if map_url:
            lines.append(f"Live map, private to you: {map_url}")
    else:
        lines = [f"SILENT SOS from {who} at {when}. They may need help."]
        zone_sentence = _zone_sentence(payload)
        if zone_sentence:
            lines.append(f"Sent automatically: they {zone_sentence}.")
        if event.trigger == "duress":
            lines.append("They used their duress PIN, so someone may be forcing them to unlock their phone.")
        lines.append("Do NOT call or text them: it may put them at risk.")
        delayed_since = _delayed_since(event, payload)
        if delayed_since:
            lines.append(f"This alert was delayed because their phone was offline. It was sent at {delayed_since}.")
        if map_url:
            lines.append(f"Live map, private to you: {map_url}")

    if event.simulated:
        lines.insert(0, "[SIMULATED for demonstration]")
    location = payload.get("location")
    if location:
        lat, lng = location["lat"], location["lng"]
        accuracy = f" (within {round(location['accuracy'])} m)" if location.get("accuracy") is not None else ""
        lines.append(f"Location{accuracy}: https://www.openstreetmap.org/?mlat={lat}&mlon={lng}#map=17/{lat}/{lng}")
    if payload.get("battery") is not None:
        lines.append(f"Phone battery: {round(payload['battery'] * 100)}%.")
    if kind != "update" and event.trigger != "share":
        lines.append("If they are in immediate danger, call 112.")
    return "\n".join(lines)


def dispatch_sos(event_id: str, kind: str = "initial") -> None:
    """Send an SOS to the user's real emergency contacts. Runs after the response, so it never raises."""
    try:
        with SessionLocal() as db:
            _dispatch(db, event_id, kind)
    except Exception:
        log.exception("sos dispatch failed: event=%s", event_id)


def emergency_contacts(db: Session, user_id: str, decoy: bool = False) -> list[Contact]:
    return list(
        db.scalars(
            select(Contact)
            .where(Contact.user_id == user_id, Contact.decoy.is_(decoy), Contact.is_emergency.is_(True))
            .order_by(Contact.created_at)
        ).all()
    )


def _dispatch(db: Session, event_id: str, kind: str) -> None:
    event = db.get(SosEvent, event_id)
    if event is None:
        return
    contacts = emergency_contacts(db, event.user_id)
    profile = db.get(Profile, event.user_id)
    share = db.scalars(
        select(LiveShareSession)
        .where(LiveShareSession.user_id == event.user_id, LiveShareSession.decoy.is_(False))
        .order_by(LiveShareSession.created_at.desc())
    ).first()
    body = build_message(event, profile.alert_name if profile else "", kind, share_url(share.id) if share else None)
    adapter = get_adapter()

    delivered = 0
    for contact in contacts:
        destination = contact.phone if contact.channel == "sms" else contact.email
        result = adapter.send(Notification(contact.channel, destination or "", body))
        delivered += result.status == "sent"
        db.add(
            NotificationRecord(
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

    if kind in ("initial", "share") or (kind == "update" and delivered):
        event.status = "no_contacts" if not contacts else "dispatched" if delivered else "undelivered"
    db.commit()
