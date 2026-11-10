from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..utils.time import new_id, utcnow


class Contact(Base):
    """A trusted contact. Decoy contacts belong to duress sessions and never receive alerts."""

    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    relationship: Mapped[str] = mapped_column(String(40), default="")
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    channel: Mapped[str] = mapped_column(String(10))  # sms | email
    # Only emergency contacts are told about an SOS or a live share.
    is_emergency: Mapped[bool] = mapped_column(Boolean, default=True)
    decoy: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
