from ...config import Settings
from .base import DeliveryResult, Notification, NotificationAdapter


class SmsAdapter(NotificationAdapter):
    """Interface for an SMS provider (MSG91 or Twilio). A stub: it checks configuration and sends nothing.

    To make it real, replace the two "stub" returns with the provider's HTTP call and return
    DeliveryResult("sent") only when the provider accepts the message.
    """

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
