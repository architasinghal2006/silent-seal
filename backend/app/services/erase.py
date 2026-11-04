from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import (
    Account,
    Breadcrumb,
    Contact,
    Delivery,
    LiveShare,
    OfflineReceipt,
    Profile,
    SosEvent,
    VaultClip,
    VaultEntry,
    VaultMeta,
    Zone,
)

_SIDED_TABLES = (VaultClip, VaultEntry, VaultMeta, Contact, Zone)


def erase_decoy_side(db: Session, account_id: str) -> None:
    """All a duress session can erase. The real evidence and contacts are out of its reach."""
    for table in _SIDED_TABLES:
        db.execute(delete(table).where(table.account_id == account_id, table.decoy.is_(True)))
    profile = db.get(Profile, account_id)
    if profile:
        profile.decoy_alert_name = ""
    db.commit()


def erase_account(db: Session, account_id: str) -> None:
    """Deletes every row for the account. Explicit because SQLite doesn't enforce cascades by default."""
    share_ids = select(LiveShare.id).where(LiveShare.account_id == account_id)
    event_ids = select(SosEvent.id).where(SosEvent.account_id == account_id)
    db.execute(delete(Breadcrumb).where(Breadcrumb.share_id.in_(share_ids)))
    db.execute(delete(Delivery).where(Delivery.sos_event_id.in_(event_ids)))
    db.execute(delete(LiveShare).where(LiveShare.account_id == account_id))
    db.execute(delete(SosEvent).where(SosEvent.account_id == account_id))
    for table in (*_SIDED_TABLES, Profile, OfflineReceipt):
        db.execute(delete(table).where(table.account_id == account_id))
    db.execute(delete(Account).where(Account.id == account_id))
    db.commit()
