from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..utils.time import new_id, utcnow


class SosEvent(Base):
    """A distress signal and, in payload, what the device captured for it."""

    __tablename__ = "sos_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    trigger: Mapped[str] = mapped_column(String(20))  # manual | duress | geofence | share
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | dispatched | undelivered | no_contacts
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    # Made by the demo tools rather than by a device. Always shown as such.
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class NotificationRecord(Base):
    """One message to one contact. Contact details are copied so the record survives contact edits."""

    __tablename__ = "notification_records"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    sos_event_id: Mapped[str] = mapped_column(ForeignKey("sos_events.id", ondelete="CASCADE"), index=True)
    contact_name: Mapped[str] = mapped_column(String(80))
    channel: Mapped[str] = mapped_column(String(10))
    destination: Mapped[str] = mapped_column(String(254))
    kind: Mapped[str] = mapped_column(String(10))  # initial | update | safe | share
    adapter: Mapped[str] = mapped_column(String(20))  # mock | sms | email | sample
    status: Mapped[str] = mapped_column(String(10))  # sent | stub | failed
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
