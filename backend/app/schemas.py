from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

PIN_PATTERN = r"^\d{4,8}$"
PHONE_PATTERN = r"^\+?\d{7,15}$"
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class SetupRequest(BaseModel):
    real_pin: str = Field(pattern=PIN_PATTERN)
    duress_pin: str = Field(pattern=PIN_PATTERN)

    @model_validator(mode="after")
    def pins_differ(self) -> "SetupRequest":
        if self.real_pin == self.duress_pin:
            raise ValueError("real and duress PIN must differ")
        return self


class SetupResponse(BaseModel):
    account_id: str


class UnlockRequest(BaseModel):
    account_id: str = Field(min_length=1, max_length=64)
    pin: str = Field(min_length=1, max_length=16)


class UnlockResponse(BaseModel):
    """Identical shape for real and duress unlocks."""

    token: str
    expires_in: int


class MeResponse(BaseModel):
    account_id: str
    created_at: datetime


class HealthResponse(BaseModel):
    status: str
    db: str


class ProfileBody(BaseModel):
    alert_name: str = Field(default="", max_length=80)


class ContactBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    phone: str | None = Field(default=None, pattern=PHONE_PATTERN)
    email: str | None = Field(default=None, pattern=EMAIL_PATTERN, max_length=254)
    channel: Literal["sms", "email"]

    @model_validator(mode="after")
    def channel_has_destination(self) -> "ContactBody":
        if self.channel == "sms" and not self.phone:
            raise ValueError("sms contacts need a phone number")
        if self.channel == "email" and not self.email:
            raise ValueError("email contacts need an email address")
        return self


class ContactOut(ContactBody):
    model_config = ConfigDict(from_attributes=True)

    id: str


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0)


class SosRequest(BaseModel):
    trigger: Literal["manual"] = "manual"
    client_ts: datetime | None = None
    battery: float | None = Field(default=None, ge=0, le=1)
    location: Location | None = None


class SosContext(BaseModel):
    location: Location | None = None
    battery: float | None = Field(default=None, ge=0, le=1)


class SosHistoryItem(BaseModel):
    created_at: datetime
    trigger: str
    status: str
    delivered: int
    undelivered: int
