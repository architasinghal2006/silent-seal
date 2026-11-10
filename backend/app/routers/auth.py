from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import AuthCredential, Profile, RevokedToken, User
from ..schemas.auth import (
    EraseRequest,
    MeResponse,
    ProfileBody,
    SetupRequest,
    SetupResponse,
    UnlockRequest,
    UnlockResponse,
)
from ..security import (
    DUMMY_HASH,
    SCOPE_DURESS,
    SCOPE_FULL,
    SessionCtx,
    create_offline_token,
    create_token,
    current_session,
    hash_pin,
    verify_pin,
)
from ..services import audit
from ..services.erase import erase_account, erase_decoy_side
from ..services.sos import dispatch_sos, record_sos
from ..utils.time import utcnow

router = APIRouter(prefix="/api", tags=["auth"])

# One generic failure for unknown user, wrong PIN and lockout alike.
_DENIED = HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid")


def create_user(db: Session, real_pin: str, duress_pin: str, is_demo: bool = False) -> User:
    user = User(is_demo=is_demo)
    db.add(user)
    db.flush()
    db.add(AuthCredential(user_id=user.id, real_pin_hash=hash_pin(real_pin), duress_pin_hash=hash_pin(duress_pin)))
    audit.record(db, audit.ACCOUNT_CREATED, user.id)
    db.commit()
    return user


@router.post("/auth/setup", response_model=SetupResponse, status_code=status.HTTP_201_CREATED)
def setup(body: SetupRequest, db: Session = Depends(get_db)) -> SetupResponse:
    user = create_user(db, body.real_pin, body.duress_pin)
    return SetupResponse(
        user_id=user.id,
        offline_real=create_offline_token(user.id, SCOPE_FULL),
        offline_duress=create_offline_token(user.id, SCOPE_DURESS),
    )


@router.post("/auth/unlock", response_model=UnlockResponse)
def unlock(body: UnlockRequest, background: BackgroundTasks, db: Session = Depends(get_db)) -> UnlockResponse:
    settings = get_settings()
    credential = db.get(AuthCredential, body.user_id)
    if credential is None:
        verify_pin(body.pin, DUMMY_HASH)
        verify_pin(body.pin, DUMMY_HASH)
        raise _DENIED

    now = utcnow()
    if credential.locked_until and credential.locked_until > now:
        raise _DENIED

    # Always check both hashes so timing does not reveal which PIN matched.
    real_ok = verify_pin(body.pin, credential.real_pin_hash)
    duress_ok = verify_pin(body.pin, credential.duress_pin_hash)

    if not (real_ok or duress_ok):
        credential.failed_attempts += 1
        audit.record(db, audit.UNLOCK_FAILED, credential.user_id)
        if credential.failed_attempts >= settings.max_failed_attempts:
            credential.locked_until = now + timedelta(seconds=settings.lockout_seconds)
            credential.failed_attempts = 0
            audit.record(db, audit.LOCKOUT, credential.user_id)
        db.commit()
        raise _DENIED

    credential.failed_attempts = 0
    credential.locked_until = None
    audit.record(db, audit.UNLOCK, credential.user_id)
    db.commit()

    if duress_ok:
        # Sent after the response so delivery time cannot distinguish this from a real unlock.
        event = record_sos(db, credential.user_id, trigger="duress")
        background.add_task(dispatch_sos, event.id)

    token, ttl = create_token(credential.user_id, duress=duress_ok)
    return UnlockResponse(token=token, expires_in=ttl)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> Response:
    """Ends this session on the server, so a copied token stops working at once."""
    db.execute(delete(RevokedToken).where(RevokedToken.expires_at < utcnow()))
    db.add(RevokedToken(jti=session.jti, expires_at=session.expires_at))
    audit.record(db, audit.LOGOUT, session.user_id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # Two logouts raced: it is revoked either way.
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=MeResponse)
def me(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> MeResponse:
    user = db.get(User, session.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    return MeResponse(user_id=user.id, created_at=user.created_at, demo=get_settings().demo_enabled)


@router.get("/profile", response_model=ProfileBody)
def get_profile(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> ProfileBody:
    profile = db.get(Profile, session.user_id)
    if profile is None:
        return ProfileBody()
    return ProfileBody(alert_name=profile.decoy_alert_name if session.duress else profile.alert_name)


@router.put("/profile", response_model=ProfileBody)
def put_profile(
    body: ProfileBody, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> ProfileBody:
    profile = db.get(Profile, session.user_id)
    if profile is None:
        profile = Profile(user_id=session.user_id, alert_name="", decoy_alert_name="")
        db.add(profile)
    if session.duress:
        profile.decoy_alert_name = body.alert_name
    else:
        profile.alert_name = body.alert_name
    db.commit()
    return body


@router.post("/account/erase", status_code=status.HTTP_204_NO_CONTENT)
def erase(
    body: EraseRequest, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> Response:
    """Real session: deletes everything. Duress session: looks the same but only clears its decoy side,
    so nobody can destroy the evidence by forcing this."""
    credential = db.get(AuthCredential, session.user_id)
    if credential is None:
        raise _DENIED
    if not verify_pin(body.pin, credential.duress_pin_hash if session.duress else credential.real_pin_hash):
        raise _DENIED
    if session.duress:
        erase_decoy_side(db, session.user_id)
    else:
        erase_account(db, session.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
