from datetime import datetime

from pydantic import BaseModel, Field, model_validator

PIN_PATTERN = r"^\d{4,8}$"


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
