import logging
import smtplib
import ssl
from email.message import EmailMessage

from ...config import Settings
from .base import DeliveryResult, Notification, NotificationAdapter

log = logging.getLogger("silentseal.notify")

_TIMEOUT_SECONDS = 15


class EmailAdapter(NotificationAdapter):
    """Sends email over SMTP, for example a Gmail account with an app password.

    "sent" is returned only when the mail server accepts the message for delivery.
    The subject is deliberately plain: it may show on a lock screen.
    """

    name = "email"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def send(self, notification: Notification) -> DeliveryResult:
        if notification.channel != "email":
            return DeliveryResult("failed", "email adapter cannot deliver to an sms contact")
        s = self.settings
        if not (s.smtp_host and s.smtp_user and s.smtp_password):
            return DeliveryResult("failed", "smtp not configured")

        message = EmailMessage()
        message["From"] = s.smtp_from or s.smtp_user
        message["To"] = notification.destination
        message["Subject"] = "Urgent: someone who trusts you needs you to read this"
        message.set_content(notification.body)

        try:
            context = ssl.create_default_context()
            if s.smtp_port == 465:
                server = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=_TIMEOUT_SECONDS, context=context)
            else:
                server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=_TIMEOUT_SECONDS)
            with server:
                if s.smtp_port != 465:
                    server.starttls(context=context)
                server.login(s.smtp_user, s.smtp_password)
                refused = server.send_message(message)
            if refused:
                return DeliveryResult("failed", "the mail server refused the recipient")
            return DeliveryResult("sent", "accepted by the mail server")
        except smtplib.SMTPAuthenticationError:
            log.warning("smtp login was refused")
            return DeliveryResult("failed", "smtp login refused: check the user and app password")
        except (smtplib.SMTPException, OSError) as error:
            log.warning("smtp send failed: %s", error.__class__.__name__)
            return DeliveryResult("failed", f"could not send email ({error.__class__.__name__})")
