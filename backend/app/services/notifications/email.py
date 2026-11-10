from ...config import Settings
from .base import DeliveryResult, Notification, NotificationAdapter


class EmailAdapter(NotificationAdapter):
    """Interface for SMTP email. A stub: it checks configuration and sends nothing.

    To make it real, replace the "stub" return with an smtplib send and return
    DeliveryResult("sent") only when the server accepts the message.
    """

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
