from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..utils.time import new_id, utcnow


class User(Base):
    """One survivor's account. Its id doubles as the recovery code, so it carries nothing else."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    # Created by the demo tools. Only these may receive simulated alerts.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuthCredential(Base):
    """scrypt hashes of both PINs and the unlock throttle. Never a plaintext PIN."""

    __tablename__ = "auth_credentials"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    real_pin_hash: Mapped[str] = mapped_column(String(200))
    duress_pin_hash: Mapped[str] = mapped_column(String(200))
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Profile(Base):
    """The name contacts see in alerts. Duress sessions read and write a separate decoy value."""

    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    alert_name: Mapped[str] = mapped_column(String(80), default="")
    decoy_alert_name: Mapped[str] = mapped_column(String(80), default="")


class RevokedToken(Base):
    """A session token that was logged out before it expired."""

    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(String(32), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
