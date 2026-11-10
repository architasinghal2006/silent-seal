from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from .common import EVENT_ID_PATTERN, Base64Text, Battery, Location
from .vault import MAX_ENTRY_BASE64, EvidenceClipIn

MAX_EVENTS_PER_SYNC = 50


class QueuedEvent(BaseModel):
    """One item from a device's queue. The payload is checked against its type when it is applied."""

    id: str = Field(pattern=EVENT_ID_PATTERN)
    type: Literal["sos", "unlock", "evidence"]
    timestamp: datetime | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncRequest(BaseModel):
    events: list[QueuedEvent] = Field(min_length=1, max_length=MAX_EVENTS_PER_SYNC)


class SyncResult(BaseModel):
    id: str
    # applied: took effect now. duplicate: already handled, ignored. rejected: will never be accepted.
    status: Literal["applied", "duplicate", "rejected"]


class SyncReply(BaseModel):
    results: list[SyncResult]
    stream: bool
    stream_token: str | None = None


class SosPayload(BaseModel):
    trigger: Literal["manual", "geofence"] = "manual"
    battery: Battery
    location: Location | None = None
    zone_event: Literal["entered", "left"] | None = None
    zone_kind: Literal["danger", "safe"] | None = None
    trail: list[Location] = Field(default_factory=list, max_length=50)


class UnlockPayload(BaseModel):
    battery: Battery
    location: Location | None = None


class EvidencePayload(EvidenceClipIn):
    # Larger than an SOS clip: evidence added offline can be a photo.
    ciphertext: Annotated[Base64Text, Field(max_length=MAX_ENTRY_BASE64)]


class OfflineTokenReply(BaseModel):
    token: str


class OfflineStatus(BaseModel):
    last_sync_at: datetime | None = None
    applied: int = 0
    duplicates: int = 0
