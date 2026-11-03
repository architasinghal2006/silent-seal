import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    """Naive UTC, so SQLite and Postgres compare identically."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_id() -> str:
    return uuid.uuid4().hex


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    real_pin_hash: Mapped[str] = mapped_column(String(200))
    duress_pin_hash: Mapped[str] = mapped_column(String(200))
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SosEvent(Base):
    """A distress signal and, in payload, what the device captured for it."""

    __tablename__ = "sos_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    trigger: Mapped[str] = mapped_column(String(20))  # manual | duress | geofence
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | dispatched | undelivered | no_contacts
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Profile(Base):
    """The name contacts see in alerts. Duress sessions read and write a separate decoy value."""

    __tablename__ = "profiles"

    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    alert_name: Mapped[str] = mapped_column(String(80), default="")
    decoy_alert_name: Mapped[str] = mapped_column(String(80), default="")


class Contact(Base):
    """A trusted contact. Decoy contacts belong to duress sessions and never receive alerts."""

    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    channel: Mapped[str] = mapped_column(String(10))  # sms | email
    decoy: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Delivery(Base):
    """One message to one contact. Contact details are copied so the record survives contact edits."""

    __tablename__ = "deliveries"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    sos_event_id: Mapped[str] = mapped_column(ForeignKey("sos_events.id", ondelete="CASCADE"), index=True)
    contact_name: Mapped[str] = mapped_column(String(80))
    channel: Mapped[str] = mapped_column(String(10))
    destination: Mapped[str] = mapped_column(String(254))
    kind: Mapped[str] = mapped_column(String(10))  # initial | update | safe
    adapter: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(10))  # sent | stub | failed
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class LiveShare(Base):
    """A tokenized, expiring location share opened by an SOS. The link token is derived from the id."""

    __tablename__ = "live_shares"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    sos_event_id: Mapped[str] = mapped_column(ForeignKey("sos_events.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Breadcrumb(Base):
    """One point on a share's trail."""

    __tablename__ = "breadcrumbs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    share_id: Mapped[str] = mapped_column(ForeignKey("live_shares.id", ondelete="CASCADE"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
