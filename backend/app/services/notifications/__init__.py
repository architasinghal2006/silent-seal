from ...config import Settings, get_settings
from .base import DeliveryResult, Notification, NotificationAdapter
from .email import EmailAdapter
from .mock import MockNotificationAdapter
from .sms import SmsAdapter

__all__ = [
    "DeliveryResult",
    "EmailAdapter",
    "LiveAdapter",
    "MockNotificationAdapter",
    "Notification",
    "NotificationAdapter",
    "SmsAdapter",
    "delivers_externally",
    "get_adapter",
]


class LiveAdapter(NotificationAdapter):
    """Real delivery for every contact: SMS contacts through the SMS provider, email contacts over SMTP."""

    name = "live"

    def __init__(self, settings: Settings) -> None:
        self.sms = SmsAdapter(settings)
        self.email = EmailAdapter(settings)

    def send(self, notification: Notification) -> DeliveryResult:
        adapter = self.sms if notification.channel == "sms" else self.email
        result = adapter.send(notification)
        # Records which provider handled it, so every screen can say how a message went out.
        return DeliveryResult(result.status, result.detail, via=adapter.name)


def get_adapter() -> NotificationAdapter:
    settings = get_settings()
    if settings.notify_adapter == "live":
        return LiveAdapter(settings)
    if settings.notify_adapter == "sms":
        return SmsAdapter(settings)
    if settings.notify_adapter == "email":
        return EmailAdapter(settings)
    return MockNotificationAdapter()


def delivers_externally(settings: Settings) -> bool:
    """True when the current settings can actually put a message on someone's phone or inbox."""
    sms = settings.sms_provider == "twilio" and bool(settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from)
    email = bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)
    return {"live": sms or email, "sms": sms, "email": email}.get(settings.notify_adapter, False)
