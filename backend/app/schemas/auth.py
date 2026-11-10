from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from .common import PIN_PATTERN


class SetupRequest(BaseModel):
    real_pin: str = Field(pattern=PIN_PATTERN)
    duress_pin: str = Field(pattern=PIN_PATTERN)

    @model_validator(mode="after")
    def pins_differ(self) -> "SetupRequest":
        if self.real_pin == self.duress_pin:
            raise ValueError("real and duress PIN must differ")
        return self


class SetupResponse(BaseModel):
    user_id: str
    offline_real: str
    offline_duress: str


class UnlockRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    pin: str = Field(min_length=1, max_length=16)


class UnlockResponse(BaseModel):
    """Identical shape for real and duress unlocks."""

    token: str
    expires_in: int


class MeResponse(BaseModel):
    user_id: str
    created_at: datetime
    # True when the server runs with its demo tools on, so the app can label simulated parts.
    demo: bool


class EraseRequest(BaseModel):
    pin: str = Field(min_length=1, max_length=16)


class ProfileBody(BaseModel):
    alert_name: str = Field(default="", max_length=80)
