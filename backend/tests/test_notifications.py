"""Real delivery adapters. The network is replaced, so no message leaves the test run."""

import io
import json
import smtplib
import urllib.error

import pytest

from app.config import get_settings
from app.services.notifications import (
    EmailAdapter,
    LiveAdapter,
    Notification,
    SmsAdapter,
    delivers_externally,
    get_adapter,
)
from app.services.notifications import email as email_module
from app.services.notifications import sms as sms_module

BODY = "SILENT SOS from Meera at 10 Nov 16:00 IST. They may need help."
TWILIO = {"sms_provider": "twilio", "twilio_account_sid": "AC123", "twilio_auth_token": "secret-token", "twilio_from": "+15005550006"}
SMTP = {"smtp_host": "smtp.example.org", "smtp_port": 587, "smtp_user": "alerts@example.org", "smtp_password": "app-password", "smtp_from": ""}


def _settings(**changes):
    blank = {"sms_provider": "", "msg91_auth_key": "", "twilio_account_sid": "", "twilio_auth_token": "", "twilio_from": "", "smtp_host": "", "smtp_user": "", "smtp_password": ""}
    return get_settings().model_copy(update={**blank, **changes})


class _Reply:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture()
def twilio(monkeypatch):
    """Captures what would be sent to Twilio and answers as Twilio does."""
    sent = []

    def fake_urlopen(request, timeout=None):
        sent.append(request)
        return _Reply({"sid": "SM1", "status": "queued"})

    monkeypatch.setattr(sms_module.urllib.request, "urlopen", fake_urlopen)
    return sent


class _FakeSmtp:
    instances: list["_FakeSmtp"] = []
    login_error: Exception | None = None

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port, self.tls, self.logged_in, self.messages = host, port, False, None, []
        _FakeSmtp.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def starttls(self, context=None):
        self.tls = True

    def login(self, user, password):
        if _FakeSmtp.login_error:
            raise _FakeSmtp.login_error
        self.logged_in = user

    def send_message(self, message):
        self.messages.append(message)
        return {}


@pytest.fixture()
def smtp(monkeypatch):
    _FakeSmtp.instances, _FakeSmtp.login_error = [], None
    monkeypatch.setattr(email_module.smtplib, "SMTP", _FakeSmtp)
    monkeypatch.setattr(email_module.smtplib, "SMTP_SSL", _FakeSmtp)
    return _FakeSmtp


# ---------- SMS through Twilio ----------


def test_twilio_sms_is_sent_with_the_message_and_reported_only_once_accepted(twilio):
    result = SmsAdapter(_settings(**TWILIO)).send(Notification("sms", "+919800000001", BODY))

    assert result.status == "sent" and "accepted by twilio" in result.detail
    request = twilio[0]
    assert request.full_url == "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json"
    form = request.data.decode()
    assert "To=%2B919800000001" in form and "From=%2B15005550006" in form and "SILENT+SOS+from+Meera" in form
    assert request.get_header("Authorization").startswith("Basic ")


def test_a_number_saved_without_a_plus_still_gets_one(twilio):
    SmsAdapter(_settings(**TWILIO)).send(Notification("sms", "919800000001", BODY))
    assert "To=%2B919800000001" in twilio[0].data.decode()


def test_twilio_refusal_is_a_failure_with_its_reason(monkeypatch):
    def refuse(request, timeout=None):
        raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {}, io.BytesIO(b'{"message": "The number +919800000001 is unverified."}'))

    monkeypatch.setattr(sms_module.urllib.request, "urlopen", refuse)
    result = SmsAdapter(_settings(**TWILIO)).send(Notification("sms", "+919800000001", BODY))
    assert result.status == "failed" and "unverified" in result.detail and "http 400" in result.detail


def test_twilio_being_unreachable_is_a_failure_not_a_crash(monkeypatch):
    def offline(request, timeout=None):
        raise urllib.error.URLError("no route")

    monkeypatch.setattr(sms_module.urllib.request, "urlopen", offline)
    result = SmsAdapter(_settings(**TWILIO)).send(Notification("sms", "+919800000001", BODY))
    assert result.status == "failed" and "could not reach twilio" in result.detail


def test_half_configured_or_unconfigured_sms_never_reports_sent(twilio):
    partial = SmsAdapter(_settings(sms_provider="twilio", twilio_account_sid="AC123")).send(Notification("sms", "+91", BODY))
    nothing = SmsAdapter(_settings()).send(Notification("sms", "+91", BODY))
    msg91 = SmsAdapter(_settings(sms_provider="msg91", msg91_auth_key="k")).send(Notification("sms", "+91", BODY))
    assert (partial.status, nothing.status, msg91.status) == ("failed", "failed", "stub")
    assert twilio == []


def test_sms_adapter_refuses_an_email_contact(twilio):
    assert SmsAdapter(_settings(**TWILIO)).send(Notification("email", "a@b.c", BODY)).status == "failed"
    assert twilio == []


# ---------- Email over SMTP ----------


def test_email_is_sent_over_an_encrypted_authenticated_connection(smtp):
    result = EmailAdapter(_settings(**SMTP)).send(Notification("email", "meera@example.org", BODY))

    assert result.status == "sent"
    server = smtp.instances[0]
    assert (server.host, server.port, server.tls, server.logged_in) == ("smtp.example.org", 587, True, "alerts@example.org")
    message = server.messages[0]
    assert message["To"] == "meera@example.org" and message["From"] == "alerts@example.org"
    assert BODY in message.get_content()
    # The subject can show on a lock screen, so it names nobody and gives no detail.
    assert "Meera" not in message["Subject"] and "SOS" not in message["Subject"]


def test_wrong_smtp_password_is_a_failure_with_a_useful_reason(smtp):
    smtp.login_error = smtplib.SMTPAuthenticationError(535, b"bad credentials")
    result = EmailAdapter(_settings(**SMTP)).send(Notification("email", "meera@example.org", BODY))
    assert result.status == "failed" and "app password" in result.detail
    assert smtp.instances[0].messages == []


def test_unconfigured_email_never_reports_sent_and_refuses_sms_contacts(smtp):
    assert EmailAdapter(_settings()).send(Notification("email", "a@b.c", BODY)).status == "failed"
    assert EmailAdapter(_settings(**SMTP)).send(Notification("sms", "+91", BODY)).status == "failed"
    assert smtp.instances == []


# ---------- Both together ----------


def test_live_adapter_reaches_each_contact_by_their_own_channel(twilio, smtp):
    adapter = LiveAdapter(_settings(**TWILIO, **SMTP))
    by_sms = adapter.send(Notification("sms", "+919800000001", BODY))
    by_email = adapter.send(Notification("email", "meera@example.org", BODY))

    assert (by_sms.status, by_sms.via) == ("sent", "sms")
    assert (by_email.status, by_email.via) == ("sent", "email")
    assert len(twilio) == 1 and len(smtp.instances[0].messages) == 1


def test_adapter_choice_and_whether_anything_really_goes_out(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "notify_adapter", "live")
    assert isinstance(get_adapter(), LiveAdapter)

    assert delivers_externally(_settings(notify_adapter="mock", **TWILIO, **SMTP)) is False
    assert delivers_externally(_settings(notify_adapter="live")) is False
    assert delivers_externally(_settings(notify_adapter="live", **SMTP)) is True
    assert delivers_externally(_settings(notify_adapter="sms", **SMTP)) is False
    assert delivers_externally(_settings(notify_adapter="sms", **TWILIO)) is True


def test_a_real_alert_records_which_provider_carried_each_message(client, account, real, monkeypatch, twilio, smtp):
    settings = get_settings()
    for key, value in {"notify_adapter": "live", **TWILIO, **SMTP}.items():
        monkeypatch.setattr(settings, key, value)
    client.post("/api/contacts", json={"name": "Asha", "phone": "+919800000001", "channel": "sms"}, headers=real)
    client.post("/api/contacts", json={"name": "Meera", "email": "meera@example.org", "channel": "email"}, headers=real)

    event_id = client.post("/api/sos", json={}, headers=real).json()["event_id"]

    status = client.get(f"/api/sos/{event_id}", headers=real).json()
    assert status["status"] == "dispatched"
    assert sorted((d["contact_name"], d["adapter"], d["status"]) for d in status["deliveries"]) == [
        ("Asha", "sms", "sent"),
        ("Meera", "email", "sent"),
    ]
    assert "SILENT SOS" in twilio[0].data.decode().replace("+", " ")
