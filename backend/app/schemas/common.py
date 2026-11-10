import base64
import binascii
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

PIN_PATTERN = r"^\d{4,8}$"
PHONE_PATTERN = r"^\+?\d{7,15}$"
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
HASH_PATTERN = r"^[0-9a-f]{64}$"
EVENT_ID_PATTERN = r"^[0-9a-f]{16,64}$"


def _is_base64(value: str) -> str:
    try:
        base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("must be base64")
    return value


def _is_iv(value: str) -> str:
    if len(base64.b64decode(_is_base64(value))) != 12:
        raise ValueError("must be a 12-byte IV")
    return value


Base64Text = Annotated[str, AfterValidator(_is_base64)]
Iv = Annotated[str, Field(max_length=32), AfterValidator(_is_iv)]
Battery = Annotated[float | None, Field(default=None, ge=0, le=1)]


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0)


class HealthResponse(BaseModel):
    status: str
    db: str
