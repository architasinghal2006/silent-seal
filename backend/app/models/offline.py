from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..utils.time import utcnow


class OfflineQueueEvent(Base):
    """A queued event the server has already handled, so a retry after a lost reply takes effect once."""

    __tablename__ = "offline_queue_events"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(20))  # sos | unlock | evidence
    client_ts: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # How many times the device sent this again after it was first handled.
    duplicates: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
