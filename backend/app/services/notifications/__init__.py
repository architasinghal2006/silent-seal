from ...config import get_settings
from .base import DeliveryResult, Notification, NotificationAdapter
from .email import EmailAdapter
from .mock import MockNotificationAdapter
from .sms import SmsAdapter

__all__ = [
    "DeliveryResult",
    "EmailAdapter",
    "MockNotificationAdapter",
    "Notification",
    "NotificationAdapter",
    "SmsAdapter",
    "get_adapter",
]


def get_adapter() -> NotificationAdapter:
    settings = get_settings()
    if settings.notify_adapter == "sms":
        return SmsAdapter(settings)
    if settings.notify_adapter == "email":
        return EmailAdapter(settings)
    return MockNotificationAdapter()
