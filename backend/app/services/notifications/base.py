from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class Notification:
    channel: str  # sms | email
    destination: str
    body: str


@dataclass(frozen=True)
class DeliveryResult:
    # sent: the adapter handed the message on. stub: a stub ran and sent nothing. failed: not sent.
    status: str
    detail: str | None = None
    # Set when one adapter hands the message to another, to record which one actually handled it.
    via: str | None = None


class NotificationAdapter(ABC):
    """One way of reaching a trusted contact. Adapters never raise: a failure is a result."""

    name: str

    @abstractmethod
    def send(self, notification: Notification) -> DeliveryResult: ...
