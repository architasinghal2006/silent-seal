from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from .common import Battery, Location


class SosRequest(BaseModel):
    trigger: Literal["manual"] = "manual"
    client_ts: datetime | None = None
    battery: Battery
    location: Location | None = None


class SosAccepted(BaseModel):
    accepted: bool
    event_id: str


class SosContext(BaseModel):
    location: Location | None = None
    battery: Battery


class StreamReply(BaseModel):
    """Identical shape in real and duress sessions: the client just keeps streaming or stops."""

    stream: bool
    stream_token: str | None = None


class SosHistoryItem(BaseModel):
    id: str
    created_at: datetime
    trigger: str
    status: str
    delivered: int
    undelivered: int
    # Sample history added by the demo tools, never something a device sent.
    simulated: bool = False


class DeliveryStatus(BaseModel):
    contact_name: str
    channel: str
    # mock means nothing left this server. sms and email are stubs that send nothing either.
    adapter: str
    status: str  # sent | stub | failed | pending
    kind: str


class SosStatus(BaseModel):
    id: str
    created_at: datetime
    trigger: str
    status: str
    location_captured: bool
    battery: float | None = None
    deliveries: list[DeliveryStatus]
    live_share_active: bool
