from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field

from .common import HASH_PATTERN, Base64Text, Iv

GENESIS_HASH = "0" * 64
MAX_ENTRY_BASE64 = 16 * 1024 * 1024
MAX_CLIP_BASE64 = 4 * 1024 * 1024
BUNDLE_FORMAT = "ssv1"


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


class EvidenceIn(BaseModel):
    seq: int = Field(ge=1)
    prev_hash: str = Field(pattern=HASH_PATTERN)
    iv: Iv
    ciphertext: Annotated[Base64Text, Field(max_length=MAX_ENTRY_BASE64)]
    entry_hash: str = Field(pattern=HASH_PATTERN)


class EvidenceOut(BaseModel):
    id: str
    seq: int
    prev_hash: str
    iv: str
    ciphertext: str
    payload_hash: str
    entry_hash: str
    created_at: datetime


class EvidenceClipIn(BaseModel):
    iv: Iv
    ciphertext: Annotated[Base64Text, Field(max_length=MAX_CLIP_BASE64)]
    wrapped_key: Annotated[Base64Text, Field(max_length=1024)]


class EvidenceClipOut(BaseModel):
    id: str
    iv: str
    ciphertext: str
    wrapped_key: str


class ChainProblem(BaseModel):
    # modified | missing | broken_link | count_mismatch | head_mismatch | unreadable
    kind: str
    position: int | None = None
    detail: str


class VerifyRequest(BaseModel):
    """An exported bundle, checked exactly as given. Nothing in it is trusted or stored."""

    bundle: dict[str, Any]


class VerifyResult(BaseModel):
    valid: bool
    count: int
    head_hash: str | None = None
    problems: list[ChainProblem]
    # Integrity only: says the record was not altered, never that an event took place.
    scope: str
