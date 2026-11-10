import logging

from .base import DeliveryResult, Notification, NotificationAdapter

log = logging.getLogger("silentseal.notify")


class MockNotificationAdapter(NotificationAdapter):
    """Default. Delivers nothing outside this server: the message is recorded for the judge dashboard.

    "sent" from this adapter means "recorded by the simulation", and every screen that shows
    it says so. The message text is deliberately not logged: it holds a name and a location.
    """

    name = "mock"

    def send(self, notification: Notification) -> DeliveryResult:
        log.info("mock %s notification recorded (%d characters)", notification.channel, len(notification.body))
        return DeliveryResult("sent", "simulated: nothing left this server")
