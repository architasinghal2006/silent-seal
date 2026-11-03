from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Contact, Profile
from ..schemas import ContactBody, ContactOut, ProfileBody
from ..security import SessionCtx, current_session

router = APIRouter(prefix="/api", tags=["contacts"])


def _owned(db: Session, session: SessionCtx, contact_id: str) -> Contact:
    """A session only ever sees its own side: real contacts, or the duress session's decoys."""
    contact = db.get(Contact, contact_id)
    if contact is None or contact.account_id != session.account_id or contact.decoy != session.duress:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    return contact


@router.get("/contacts", response_model=list[ContactOut])
def list_contacts(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)):
    return db.scalars(
        select(Contact)
        .where(Contact.account_id == session.account_id, Contact.decoy.is_(session.duress))
        .order_by(Contact.created_at)
    ).all()


@router.post("/contacts", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_contact(
    body: ContactBody, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
):
    contact = Contact(account_id=session.account_id, decoy=session.duress, **body.model_dump())
    db.add(contact)
    db.commit()
    return contact


@router.put("/contacts/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: str,
    body: ContactBody,
    session: SessionCtx = Depends(current_session),
    db: Session = Depends(get_db),
):
    contact = _owned(db, session, contact_id)
    for field, value in body.model_dump().items():
        setattr(contact, field, value)
    db.commit()
    return contact


@router.delete("/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: str, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> Response:
    db.delete(_owned(db, session, contact_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/profile", response_model=ProfileBody)
def get_profile(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> ProfileBody:
    profile = db.get(Profile, session.account_id)
    if profile is None:
        return ProfileBody()
    return ProfileBody(alert_name=profile.decoy_alert_name if session.duress else profile.alert_name)


@router.put("/profile", response_model=ProfileBody)
def put_profile(
    body: ProfileBody, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> ProfileBody:
    profile = db.get(Profile, session.account_id)
    if profile is None:
        profile = Profile(account_id=session.account_id, alert_name="", decoy_alert_name="")
        db.add(profile)
    if session.duress:
        profile.decoy_alert_name = body.alert_name
    else:
        profile.alert_name = body.alert_name
    db.commit()
    return body
