from datetime import datetime

from pydantic import BaseModel


class TrailPoint(BaseModel):
    lat: float
    lng: float
    accuracy: float | None = None
    at: datetime


class Viewer(BaseModel):
    name: str
    relationship: str


class LiveShareStatus(BaseModel):
    """What the survivor's own screen shows. A duress session only ever sees its decoy share."""

    active: bool
    started_at: datetime | None = None
    expires_at: datetime | None = None
    share_url: str | None = None
    points: list[TrailPoint] = []
    viewers: list[Viewer] = []


class LiveShareStarted(LiveShareStatus):
    stream_token: str | None = None
