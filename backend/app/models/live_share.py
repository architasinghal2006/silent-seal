from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..utils.time import new_id, utcnow


class LiveShareSession(Base):
    """A tokenized, expiring location share. The link token is derived from the id.

    A decoy session is what a duress session sees and controls. It has no SOS behind it,
    nobody is told about it, and ending it leaves the real session running.
    """

    __tablename__ = "live_share_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    sos_event_id: Mapped[str | None] = mapped_column(ForeignKey("sos_events.id", ondelete="CASCADE"), nullable=True)
    decoy: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class LocationPoint(Base):
    """One point on a share's trail."""

    __tablename__ = "location_points"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    share_id: Mapped[str] = mapped_column(ForeignKey("live_share_sessions.id", ondelete="CASCADE"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
