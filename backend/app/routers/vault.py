"""Evidence vault storage. Everything sensitive is encrypted on the device: this only ever sees ciphertext.

Each session stays on its own side, so a duress session has a separate, empty vault and
can never read, extend or remove the real one.
"""

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import VaultClip, VaultEntry, VaultMeta
from ..schemas import GENESIS_HASH, VaultClipIn, VaultClipOut, VaultEntryIn, VaultEntryOut, VaultHead, VaultMetaBody, VaultMetaOut
from ..security import SessionCtx, current_session

router = APIRouter(prefix="/api/vault", tags=["vault"])


def entry_hash(seq: int, prev_hash: str, iv: str, ciphertext: str) -> str:
    """Must match entryHash in frontend/src/lib/crypto.ts and tools/verify_bundle.py."""
    return hashlib.sha256(f"{seq}|{prev_hash}|{iv}|{ciphertext}".encode()).hexdigest()


def _meta(db: Session, session: SessionCtx) -> VaultMeta | None:
    return db.get(VaultMeta, (session.account_id, session.duress))


def _head(db: Session, session: SessionCtx) -> VaultHead:
    last = db.scalars(
        select(VaultEntry)
        .where(VaultEntry.account_id == session.account_id, VaultEntry.decoy.is_(session.duress))
        .order_by(VaultEntry.seq.desc())
    ).first()
    return VaultHead(seq=last.seq, hash=last.entry_hash) if last else VaultHead(seq=0, hash=GENESIS_HASH)


@router.get("/meta", response_model=VaultMetaOut)
def get_meta(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> VaultMetaOut:
    meta = _meta(db, session)
    if meta is None:
        return VaultMetaOut(configured=False)
    return VaultMetaOut(
        configured=True,
        salt=meta.salt,
        iterations=meta.iterations,
        verifier_iv=meta.verifier_iv,
        verifier_ct=meta.verifier_ct,
        public_key=meta.public_key,
        private_iv=meta.private_iv,
        private_ct=meta.private_ct,
    )


@router.put("/meta", status_code=status.HTTP_201_CREATED)
def create_meta(
    body: VaultMetaBody, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> dict[str, bool]:
    if _meta(db, session) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "already configured")
    db.add(VaultMeta(account_id=session.account_id, decoy=session.duress, **body.model_dump()))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "already configured")
    return {"configured": True}


@router.get("/head", response_model=VaultHead)
def get_head(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> VaultHead:
    return _head(db, session)


@router.get("/entries", response_model=list[VaultEntryOut])
def list_entries(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)):
    return db.scalars(
        select(VaultEntry)
        .where(VaultEntry.account_id == session.account_id, VaultEntry.decoy.is_(session.duress))
        .order_by(VaultEntry.seq)
    ).all()


@router.post("/entries", response_model=VaultEntryOut, status_code=status.HTTP_201_CREATED)
def append_entry(
    body: VaultEntryIn, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> VaultEntry:
    """Append-only: there is deliberately no way to edit or delete one entry."""
    if _meta(db, session) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vault not configured")
    head = _head(db, session)
    if body.seq != head.seq + 1 or body.prev_hash != head.hash:
        raise HTTPException(status.HTTP_409_CONFLICT, "not at chain head")
    if body.entry_hash != entry_hash(body.seq, body.prev_hash, body.iv, body.ciphertext):
        raise HTTPException(422, "hash mismatch")

    entry = VaultEntry(account_id=session.account_id, decoy=session.duress, **body.model_dump())
    db.add(entry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "not at chain head")
    return entry


@router.get("/clips", response_model=list[VaultClipOut])
def list_clips(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)):
    return db.scalars(
        select(VaultClip)
        .where(VaultClip.account_id == session.account_id, VaultClip.decoy.is_(session.duress))
        .order_by(VaultClip.created_at)
    ).all()


@router.post("/clips", status_code=status.HTTP_201_CREATED)
def add_clip(
    body: VaultClipIn, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> dict[str, bool]:
    """Audio captured during an SOS, sealed to the vault's public key while the vault is locked.

    Discarded under duress: it would otherwise appear in the decoy vault, where the person
    forcing the unlock could play it. The reply is the same either way.
    """
    if session.duress:
        return {"accepted": True}
    if _meta(db, session) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vault not configured")
    db.add(VaultClip(account_id=session.account_id, decoy=session.duress, **body.model_dump()))
    db.commit()
    return {"accepted": True}


@router.delete("/clips/{clip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_clip(
    clip_id: str, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> Response:
    clip = db.get(VaultClip, clip_id)
    if clip is None or clip.account_id != session.account_id or clip.decoy != session.duress:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    db.delete(clip)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
