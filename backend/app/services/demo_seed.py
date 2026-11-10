"""Sample data and simulated alerts for the judging demonstration.

Everything made here is marked: users carry is_demo, events carry simulated, and sample
notification records use the adapter name "sample". Nothing here is ever presented as a
real delivery, a real device or a real person. All names, numbers and addresses are invented.
"""

import json
import secrets
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    AuthCredential,
    Contact,
    LiveShareSession,
    LocationPoint,
    NotificationRecord,
    Profile,
    SosEvent,
    User,
    Zone,
)
from ..security import hash_pin
from ..utils.time import utcnow
from . import audit
from .sos import record_sos

DEMO_REAL_PIN = "2468"
DEMO_DURESS_PIN = "1357"
DEMO_SENDER_NAME = "Riya (demo sender)"

# +91 98000 000xx and example.org are not assigned to anyone.
SAMPLE_CONTACTS = [
    {"name": "Asha Verma", "relationship": "Sister", "channel": "sms", "phone": "+919800000001", "email": None, "is_emergency": True},
    {"name": "Meera Nair", "relationship": "Friend", "channel": "email", "phone": None, "email": "meera@example.org", "is_emergency": True},
    {"name": "Kavita Rao", "relationship": "Colleague", "channel": "sms", "phone": "+919800000003", "email": None, "is_emergency": False},
]

# Offsets in degrees from a centre point, so sample zones sit around wherever the demo is run.
SAMPLE_ZONES = [
    {"name": "Home", "kind": "safe", "d_lat": 0.0, "d_lng": 0.0, "radius": 200},
    {"name": "Workplace", "kind": "safe", "d_lat": 0.012, "d_lng": 0.009, "radius": 250},
    {"name": "College", "kind": "safe", "d_lat": -0.010, "d_lng": 0.015, "radius": 300},
    {"name": "Riverside lane", "kind": "danger", "d_lat": 0.006, "d_lng": -0.011, "radius": 350},
]

DEFAULT_CENTRE = (28.6315, 77.2167)  # Connaught Place, New Delhi

# A short walk, as offsets from the centre. The simulated trail steps along it.
_ROUTE = [
    (0.0000, 0.0000), (0.0004, 0.0003), (0.0008, 0.0005), (0.0013, 0.0006), (0.0018, 0.0010),
    (0.0021, 0.0016), (0.0022, 0.0023), (0.0026, 0.0029), (0.0031, 0.0033), (0.0037, 0.0034),
    (0.0042, 0.0038), (0.0046, 0.0044), (0.0047, 0.0051), (0.0051, 0.0057), (0.0056, 0.0060),
]
ROUTE = [(DEFAULT_CENTRE[0] + a, DEFAULT_CENTRE[1] + b) for a, b in _ROUTE]
SIMULATION_STEP = timedelta(seconds=4)


def _add_contacts(db: Session, user_id: str, decoy: bool = False) -> None:
    for contact in SAMPLE_CONTACTS:
        db.add(Contact(user_id=user_id, decoy=decoy, **contact))


def create_demo_user(db: Session, alert_name: str, real_pin: str, duress_pin: str) -> User:
    user = User(is_demo=True)
    db.add(user)
    db.flush()
    db.add(AuthCredential(user_id=user.id, real_pin_hash=hash_pin(real_pin), duress_pin_hash=hash_pin(duress_pin)))
    db.add(Profile(user_id=user.id, alert_name=alert_name, decoy_alert_name=""))
    _add_contacts(db, user.id)
    audit.record(db, audit.ACCOUNT_CREATED, user.id)
    db.commit()
    return user


def demo_sender(db: Session) -> User:
    """The one account simulated alerts come from. Its PINs are random and thrown away: nobody logs in to it."""
    existing = db.scalars(
        select(User)
        .join(Profile, Profile.user_id == User.id)
        .where(User.is_demo.is_(True), Profile.alert_name == DEMO_SENDER_NAME)
        .order_by(User.created_at.desc())
    ).first()
    if existing:
        return existing
    pins = [f"{secrets.randbelow(10**8):08d}" for _ in range(2)]
    return create_demo_user(db, DEMO_SENDER_NAME, pins[0], pins[1])


def simulate_sos(db: Session) -> SosEvent:
    """A simulated alert from the demo sender, starting a trail that advance_simulations() walks forward."""
    user = demo_sender(db)
    lat, lng = ROUTE[0]
    payload = {"location": {"lat": lat, "lng": lng, "accuracy": 18}, "battery": 0.42}
    event = record_sos(db, user.id, trigger="manual", payload=payload, simulated=True)
    share = db.scalars(
        select(LiveShareSession)
        .where(LiveShareSession.user_id == user.id, LiveShareSession.decoy.is_(False), LiveShareSession.ended_at.is_(None))
        .order_by(LiveShareSession.created_at.desc())
    ).first()
    if share and _point_count(db, share.id) == 0:
        db.add(LocationPoint(share_id=share.id, lat=lat, lng=lng, accuracy=18))
        db.commit()
    return event


def _point_count(db: Session, share_id: str) -> int:
    return db.scalar(select(func.count()).select_from(LocationPoint).where(LocationPoint.share_id == share_id)) or 0


def advance_simulations(db: Session) -> None:
    """Moves each simulated trail one step along the route, if enough time has passed. Called when the dashboard polls."""
    now = utcnow()
    shares = db.scalars(
        select(LiveShareSession)
        .join(User, User.id == LiveShareSession.user_id)
        .join(Profile, Profile.user_id == User.id)
        .where(
            User.is_demo.is_(True),
            Profile.alert_name == DEMO_SENDER_NAME,
            LiveShareSession.decoy.is_(False),
            LiveShareSession.ended_at.is_(None),
            LiveShareSession.expires_at > now,
        )
    ).all()
    for share in shares:
        count = _point_count(db, share.id)
        if count >= len(ROUTE):
            continue
        last = db.scalar(select(func.max(LocationPoint.created_at)).where(LocationPoint.share_id == share.id))
        if last is not None and now - last < SIMULATION_STEP:
            continue
        lat, lng = ROUTE[count]
        db.add(LocationPoint(share_id=share.id, lat=lat, lng=lng, accuracy=15))
    db.commit()


def add_sample_data(db: Session, user_id: str, decoy: bool, centre: tuple[float, float] | None) -> None:
    """Fills one side of an account so no screen is empty. The decoy side gets contacts and zones only.

    Past alerts are created as simulated, with "sample" notification records that say nothing was sent.
    """
    lat, lng = centre or DEFAULT_CENTRE

    has_contacts = db.scalars(select(Contact.id).where(Contact.user_id == user_id, Contact.decoy.is_(decoy))).first()
    if not has_contacts:
        _add_contacts(db, user_id, decoy)

    has_zones = db.scalars(select(Zone.id).where(Zone.user_id == user_id, Zone.decoy.is_(decoy))).first()
    if not has_zones:
        for zone in SAMPLE_ZONES:
            db.add(
                Zone(
                    user_id=user_id,
                    decoy=decoy,
                    name=zone["name"],
                    kind=zone["kind"],
                    lat=lat + zone["d_lat"],
                    lng=lng + zone["d_lng"],
                    radius=zone["radius"],
                    enabled=True,
                    on_enter=zone["kind"] == "danger",
                    on_exit=zone["kind"] == "safe",
                )
            )

    profile = db.get(Profile, user_id)
    if profile is None:
        profile = Profile(user_id=user_id, alert_name="", decoy_alert_name="")
        db.add(profile)
    if not decoy and not profile.alert_name:
        profile.alert_name = "Ananya"

    has_sample_history = db.scalars(
        select(SosEvent.id).where(SosEvent.user_id == user_id, SosEvent.simulated.is_(True))
    ).first()
    if not decoy and not has_sample_history:
        now = utcnow()
        for days_ago, trigger, battery in ((9, "geofence", 0.71), (3, "manual", 0.38)):
            at = now - timedelta(days=days_ago, hours=2)
            payload = {"location": {"lat": lat, "lng": lng, "accuracy": 22}, "battery": battery}
            if trigger == "geofence":
                payload |= {"zone_event": "entered", "zone_kind": "danger"}
            event = SosEvent(
                user_id=user_id, trigger=trigger, status="dispatched", payload=json.dumps(payload), simulated=True, created_at=at
            )
            db.add(event)
            db.flush()
            share = LiveShareSession(
                user_id=user_id,
                sos_event_id=event.id,
                decoy=False,
                created_at=at,
                expires_at=at + timedelta(hours=2),
                ended_at=at + timedelta(minutes=35),
            )
            db.add(share)
            db.flush()
            for step, (d_lat, d_lng) in enumerate(_ROUTE[:8]):
                db.add(
                    LocationPoint(
                        share_id=share.id, lat=lat + d_lat, lng=lng + d_lng, accuracy=20, created_at=at + timedelta(minutes=step * 4)
                    )
                )
            for contact in SAMPLE_CONTACTS:
                if contact["is_emergency"]:
                    db.add(
                        NotificationRecord(
                            sos_event_id=event.id,
                            contact_name=contact["name"],
                            channel=contact["channel"],
                            destination=contact["phone"] or contact["email"],
                            kind="initial",
                            adapter="sample",
                            status="sent",
                            detail="sample data: nothing was sent",
                            body="[Sample history for demonstration. No message was sent.]",
                            created_at=at,
                        )
                    )
    db.commit()
