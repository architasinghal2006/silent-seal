import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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


class VaultMeta(Base):
    """What the device needs to re-derive its key. Holds no key. Duress gets its own row and vault."""

    __tablename__ = "vault_meta"

    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    decoy: Mapped[bool] = mapped_column(Boolean, primary_key=True)
    salt: Mapped[str] = mapped_column(String(64))
    iterations: Mapped[int] = mapped_column(Integer)
    verifier_iv: Mapped[str] = mapped_column(String(32))
    verifier_ct: Mapped[str] = mapped_column(String(128))
    public_key: Mapped[str] = mapped_column(Text)
    private_iv: Mapped[str] = mapped_column(String(32))
    private_ct: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class VaultEntry(Base):
    """One link in the evidence hash chain. Only ciphertext: type, time and location are inside it."""

    __tablename__ = "vault_entries"
    __table_args__ = (UniqueConstraint("account_id", "decoy", "seq", name="uq_vault_chain_position"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    decoy: Mapped[bool] = mapped_column(Boolean)
    seq: Mapped[int] = mapped_column(Integer)
    prev_hash: Mapped[str] = mapped_column(String(64))
    iv: Mapped[str] = mapped_column(String(32))
    ciphertext: Mapped[str] = mapped_column(Text)
    entry_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class VaultClip(Base):
    """SOS audio sealed to the vault's public key, waiting to join the chain when the vault is next opened."""

    __tablename__ = "vault_clips"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    decoy: Mapped[bool] = mapped_column(Boolean)
    iv: Mapped[str] = mapped_column(String(32))
    ciphertext: Mapped[str] = mapped_column(Text)
    wrapped_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Zone(Base):
    """A safe or danger zone. Decoy zones belong to duress sessions and are never watched."""

    __tablename__ = "zones"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    decoy: Mapped[bool] = mapped_column(Boolean, default=False)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(10))  # danger | safe
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    radius: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class OfflineReceipt(Base):
    """Marks a queued item as handled, so a retry after a lost reply doesn't alert contacts twice."""

    __tablename__ = "offline_receipts"

    client_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
