import uuid
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def utcnow() -> datetime:
    """Naive UTC, so SQLite and Postgres compare identically."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_id() -> str:
    return uuid.uuid4().hex


def iso_z(value: datetime | None) -> str | None:
    """Naive-UTC datetimes as ISO strings a browser reads as UTC."""
    return value.isoformat() + "Z" if value else None
