from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..utils.time import new_id, utcnow


class VaultMeta(Base):
    """What the device needs to re-derive its key. Holds no key. Duress gets its own row and vault."""

    __tablename__ = "vault_meta"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    decoy: Mapped[bool] = mapped_column(Boolean, primary_key=True)
    salt: Mapped[str] = mapped_column(String(64))
    iterations: Mapped[int] = mapped_column(Integer)
    verifier_iv: Mapped[str] = mapped_column(String(32))
    verifier_ct: Mapped[str] = mapped_column(String(128))
    public_key: Mapped[str] = mapped_column(Text)
    private_iv: Mapped[str] = mapped_column(String(32))
    private_ct: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EvidenceItem(Base):
    """One piece of evidence, as ciphertext. Its type, text, time and location are all inside it."""

    __tablename__ = "evidence_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    decoy: Mapped[bool] = mapped_column(Boolean)
    iv: Mapped[str] = mapped_column(String(32))
    ciphertext: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EvidenceChainEntry(Base):
    """One link in the append-only hash chain. Enough to check the chain's links without any ciphertext."""

    __tablename__ = "evidence_chain_entries"
    __table_args__ = (UniqueConstraint("user_id", "decoy", "seq", name="uq_evidence_chain_position"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    evidence_id: Mapped[str] = mapped_column(ForeignKey("evidence_items.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    decoy: Mapped[bool] = mapped_column(Boolean)
    seq: Mapped[int] = mapped_column(Integer)
    prev_hash: Mapped[str] = mapped_column(String(64))
    payload_hash: Mapped[str] = mapped_column(String(64))
    entry_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EvidenceClip(Base):
    """Evidence sealed to the vault's public key, waiting to join the chain when the vault is next opened."""

    __tablename__ = "evidence_clips"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    decoy: Mapped[bool] = mapped_column(Boolean)
    iv: Mapped[str] = mapped_column(String(32))
    ciphertext: Mapped[str] = mapped_column(Text)
    wrapped_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
