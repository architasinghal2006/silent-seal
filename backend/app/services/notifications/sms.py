import base64
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from ...config import Settings
from .base import DeliveryResult, Notification, NotificationAdapter

log = logging.getLogger("silentseal.notify")

_TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
_TIMEOUT_SECONDS = 10


class SmsAdapter(NotificationAdapter):
    """Sends SMS through Twilio. MSG91 is still a stub that sends nothing.

    "sent" is returned only when Twilio accepts the message. Twilio accepting it is not proof
    the phone received it: carriers can still drop it, and in India delivery of unregistered
    senders is unreliable (DLT registration). A trial account can only text verified numbers.
    """

    name = "sms"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def send(self, notification: Notification) -> DeliveryResult:
        if notification.channel != "sms":
            return DeliveryResult("failed", "sms adapter cannot deliver to an email contact")
        s = self.settings
        if s.sms_provider == "twilio":
            if not (s.twilio_account_sid and s.twilio_auth_token and s.twilio_from):
                return DeliveryResult("failed", "twilio not fully configured: account sid, auth token and from number are needed")
            return self._send_twilio(notification)
        if s.sms_provider == "msg91" and s.msg91_auth_key:
            return DeliveryResult("stub", "msg91 configured; stub did not send")
        return DeliveryResult("failed", "sms provider not configured")

    def _send_twilio(self, notification: Notification) -> DeliveryResult:
        s = self.settings
        destination = notification.destination if notification.destination.startswith("+") else f"+{notification.destination}"
        form = urllib.parse.urlencode({"To": destination, "From": s.twilio_from, "Body": notification.body}).encode()
        credentials = base64.b64encode(f"{s.twilio_account_sid}:{s.twilio_auth_token}".encode()).decode()
        request = urllib.request.Request(
            _TWILIO_URL.format(sid=s.twilio_account_sid),
            data=form,
            headers={"Authorization": f"Basic {credentials}", "Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
                reply = json.loads(response.read().decode())
            return DeliveryResult("sent", f"accepted by twilio ({reply.get('status', 'queued')})")
        except urllib.error.HTTPError as error:
            # Twilio explains refusals (unverified number, bad sender) in a short JSON message.
            try:
                reason = json.loads(error.read().decode()).get("message", "")
            except (ValueError, OSError):
                reason = ""
            log.warning("twilio refused a message: http %s", error.code)
            return DeliveryResult("failed", f"twilio refused it (http {error.code}): {reason}"[:300])
        except (urllib.error.URLError, OSError, ValueError) as error:
            log.warning("twilio could not be reached: %s", error.__class__.__name__)
            return DeliveryResult("failed", f"could not reach twilio ({error.__class__.__name__})")
