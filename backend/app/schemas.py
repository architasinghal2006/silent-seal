import base64
import binascii
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

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
    offline_real: str
    offline_duress: str


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


class StreamReply(BaseModel):
    """Identical shape in real and duress sessions: the client just keeps streaming or stops."""

    stream: bool
    stream_token: str | None = None


class LiveStatus(BaseModel):
    active: bool
    expires_at: datetime | None = None


GENESIS_HASH = "0" * 64
HASH_PATTERN = r"^[0-9a-f]{64}$"
MAX_ENTRY_BASE64 = 16 * 1024 * 1024
MAX_CLIP_BASE64 = 4 * 1024 * 1024


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


class VaultMetaBody(BaseModel):
    salt: Annotated[Base64Text, Field(max_length=64)]
    # 100k is a floor to refuse weak settings; the client's default is 600k.
    iterations: int = Field(ge=100_000, le=10_000_000)
    verifier_iv: Iv
    verifier_ct: Annotated[Base64Text, Field(max_length=128)]
    public_key: str = Field(max_length=2000)
    private_iv: Iv
    private_ct: Annotated[Base64Text, Field(max_length=8000)]


class VaultMetaOut(BaseModel):
    configured: bool
    salt: str | None = None
    iterations: int | None = None
    verifier_iv: str | None = None
    verifier_ct: str | None = None
    public_key: str | None = None
    private_iv: str | None = None
    private_ct: str | None = None


class VaultHead(BaseModel):
    seq: int
    hash: str


class VaultEntryIn(BaseModel):
    seq: int = Field(ge=1)
    prev_hash: str = Field(pattern=HASH_PATTERN)
    iv: Iv
    ciphertext: Annotated[Base64Text, Field(max_length=MAX_ENTRY_BASE64)]
    entry_hash: str = Field(pattern=HASH_PATTERN)


class VaultEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seq: int
    prev_hash: str
    iv: str
    ciphertext: str
    entry_hash: str
    created_at: datetime


class VaultClipIn(BaseModel):
    iv: Iv
    ciphertext: Annotated[Base64Text, Field(max_length=MAX_CLIP_BASE64)]
    wrapped_key: Annotated[Base64Text, Field(max_length=1024)]


class VaultClipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    iv: str
    ciphertext: str
    wrapped_key: str


class EraseRequest(BaseModel):
    pin: str = Field(min_length=1, max_length=16)


CLIENT_ID_PATTERN = r"^[0-9a-f]{16,64}$"


class OfflineSos(BaseModel):
    client_id: str = Field(pattern=CLIENT_ID_PATTERN)
    trigger: Literal["manual", "geofence"] = "manual"
    client_ts: datetime | None = None
    battery: float | None = Field(default=None, ge=0, le=1)
    location: Location | None = None
    zone_event: Literal["entered", "left"] | None = None
    trail: list[Location] = Field(default_factory=list, max_length=50)


class OfflineUnlocked(BaseModel):
    client_id: str = Field(pattern=CLIENT_ID_PATTERN)
    client_ts: datetime | None = None
    battery: float | None = Field(default=None, ge=0, le=1)
    location: Location | None = None


class OfflineClip(VaultClipIn):
    client_id: str = Field(pattern=CLIENT_ID_PATTERN)
    # Larger than an SOS clip: evidence added offline can be a photo.
    ciphertext: Annotated[Base64Text, Field(max_length=MAX_ENTRY_BASE64)]


class OfflineTokenReply(BaseModel):
    token: str


class ZoneBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["danger", "safe"]
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    radius: int = Field(ge=50, le=5000)


class ZoneOut(ZoneBody):
    model_config = ConfigDict(from_attributes=True)

    id: str


class WatchZone(BaseModel):
    """Short field names on purpose: this gets cached on the phone in plain sight."""

    i: str
    a: float
    o: float
    r: int
    k: Literal["d", "s"]


class ZoneList(BaseModel):
    zones: list[ZoneOut]
    watch: list[WatchZone]
    watch_token: str | None = None
