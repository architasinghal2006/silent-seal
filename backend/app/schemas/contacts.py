from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .common import EMAIL_PATTERN, PHONE_PATTERN


class ContactBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    relationship: str = Field(default="", max_length=40)
    phone: str | None = Field(default=None, pattern=PHONE_PATTERN)
    email: str | None = Field(default=None, pattern=EMAIL_PATTERN, max_length=254)
    channel: Literal["sms", "email"]
    is_emergency: bool = True

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
