from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ZoneBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["danger", "safe"]
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    radius: int = Field(ge=50, le=5000)
    enabled: bool = True
    # Left out, these follow the zone type: a danger zone alerts on entry, a safe zone on exit.
    on_enter: bool | None = None
    on_exit: bool | None = None

    def resolved(self) -> dict:
        data = self.model_dump()
        if data["on_enter"] is None:
            data["on_enter"] = self.kind == "danger"
        if data["on_exit"] is None:
            data["on_exit"] = self.kind == "safe"
        return data


class ZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    kind: Literal["danger", "safe"]
    lat: float
    lng: float
    radius: int
    enabled: bool
    on_enter: bool
    on_exit: bool


class WatchZone(BaseModel):
    """Short field names on purpose: this gets cached on the phone in plain sight."""

    i: str
    a: float
    o: float
    r: int
    k: Literal["d", "s"]
    e: bool  # alert on entry
    x: bool  # alert on exit


class ZoneList(BaseModel):
    zones: list[ZoneOut]
    watch: list[WatchZone]
    watch_token: str | None = None
