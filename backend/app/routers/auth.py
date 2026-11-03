from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Account, utcnow
from ..schemas import MeResponse, SetupRequest, SetupResponse, UnlockRequest, UnlockResponse
from ..security import DUMMY_HASH, SessionCtx, create_token, current_session, hash_pin, verify_pin
from ..services.sos import dispatch_sos, record_sos

router = APIRouter(prefix="/api", tags=["auth"])

# One generic failure for unknown account, wrong PIN and lockout alike.
_DENIED = HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid")


@router.post("/auth/setup", response_model=SetupResponse, status_code=status.HTTP_201_CREATED)
def setup(body: SetupRequest, db: Session = Depends(get_db)) -> SetupResponse:
    account = Account(real_pin_hash=hash_pin(body.real_pin), duress_pin_hash=hash_pin(body.duress_pin))
    db.add(account)
    db.commit()
    return SetupResponse(account_id=account.id)


@router.post("/auth/unlock", response_model=UnlockResponse)
def unlock(body: UnlockRequest, background: BackgroundTasks, db: Session = Depends(get_db)) -> UnlockResponse:
    settings = get_settings()
    account = db.get(Account, body.account_id)
    if account is None:
        verify_pin(body.pin, DUMMY_HASH)
        verify_pin(body.pin, DUMMY_HASH)
        raise _DENIED

    now = utcnow()
    if account.locked_until and account.locked_until > now:
        raise _DENIED

    # Always check both hashes so timing does not reveal which PIN matched.
    real_ok = verify_pin(body.pin, account.real_pin_hash)
    duress_ok = verify_pin(body.pin, account.duress_pin_hash)

    if not (real_ok or duress_ok):
        account.failed_attempts += 1
        if account.failed_attempts >= settings.max_failed_attempts:
            account.locked_until = now + timedelta(seconds=settings.lockout_seconds)
            account.failed_attempts = 0
        db.commit()
        raise _DENIED

    account.failed_attempts = 0
    account.locked_until = None
    db.commit()

    if duress_ok:
        # Sent after the response so delivery time cannot distinguish this from a real unlock.
        event = record_sos(db, account.id, trigger="duress")
        background.add_task(dispatch_sos, event.id)

    token, ttl = create_token(account.id, duress=duress_ok)
    return UnlockResponse(token=token, expires_in=ttl)


@router.get("/me", response_model=MeResponse)
def me(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> MeResponse:
    account = db.get(Account, session.account_id)
    if account is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    return MeResponse(account_id=account.id, created_at=account.created_at)
