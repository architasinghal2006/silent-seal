import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

from ..config import Settings, get_settings

log = logging.getLogger("silentseal.notify")


@dataclass(frozen=True)
class Notification:
    channel: str  # sms | email
    destination: str
    body: str


@dataclass(frozen=True)
class DeliveryResult:
    status: str  # sent | stub | failed
    detail: str | None = None


class NotificationAdapter(ABC):
    name: str

    @abstractmethod
    def send(self, notification: Notification) -> DeliveryResult: ...


class MockAdapter(NotificationAdapter):
    """Default. Delivers nothing externally: logs here and shows in the demo dashboard."""

    name = "mock"

    def send(self, notification: Notification) -> DeliveryResult:
        log.warning("MOCK %s to %s: %s", notification.channel, notification.destination, notification.body)
        return DeliveryResult("sent")


class SmsStubAdapter(NotificationAdapter):
    """Stub for MSG91 / Twilio. Checks configuration but does not send."""

    name = "sms"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def send(self, notification: Notification) -> DeliveryResult:
        if notification.channel != "sms":
            return DeliveryResult("failed", "sms adapter cannot deliver to an email contact")
        s = self.settings
        if s.sms_provider == "msg91" and s.msg91_auth_key:
            return DeliveryResult("stub", "msg91 configured; stub did not send")
        if s.sms_provider == "twilio" and s.twilio_account_sid and s.twilio_auth_token:
            return DeliveryResult("stub", "twilio configured; stub did not send")
        return DeliveryResult("failed", "sms provider not configured")


class SmtpStubAdapter(NotificationAdapter):
    """Stub for SMTP email. Checks configuration but does not send."""

    name = "email"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def send(self, notification: Notification) -> DeliveryResult:
        if notification.channel != "email":
            return DeliveryResult("failed", "email adapter cannot deliver to an sms contact")
        s = self.settings
        if s.smtp_host and s.smtp_user and s.smtp_password:
            return DeliveryResult("stub", "smtp configured; stub did not send")
        return DeliveryResult("failed", "smtp not configured")


def get_adapter() -> NotificationAdapter:
    settings = get_settings()
    if settings.notify_adapter == "sms":
        return SmsStubAdapter(settings)
    if settings.notify_adapter == "email":
        return SmtpStubAdapter(settings)
    return MockAdapter()
