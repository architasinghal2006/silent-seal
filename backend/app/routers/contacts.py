from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Contact
from ..schemas.contacts import ContactBody, ContactOut
from ..security import SessionCtx, current_session

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _owned(db: Session, session: SessionCtx, contact_id: str) -> Contact:
    """A session only ever sees its own side: real contacts, or the duress session's decoys."""
    contact = db.get(Contact, contact_id)
    if contact is None or contact.user_id != session.user_id or contact.decoy != session.duress:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    return contact


@router.get("", response_model=list[ContactOut])
def list_contacts(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)):
    return db.scalars(
        select(Contact)
        .where(Contact.user_id == session.user_id, Contact.decoy.is_(session.duress))
        .order_by(Contact.created_at)
    ).all()


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_contact(
    body: ContactBody, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
):
    contact = Contact(user_id=session.user_id, decoy=session.duress, **body.model_dump())
    db.add(contact)
    db.commit()
    return contact


@router.put("/{contact_id}", response_model=ContactOut)
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


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: str, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> Response:
    db.delete(_owned(db, session, contact_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
