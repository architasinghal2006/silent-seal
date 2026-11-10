"""Evidence vault storage. Everything sensitive is encrypted on the device: this only ever sees ciphertext.

Each session stays on its own side, so a duress session has a separate, empty vault and
can never read, extend or remove the real one. There is no endpoint that edits or deletes
an evidence entry.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import EvidenceChainEntry, EvidenceClip, EvidenceItem, VaultMeta
from ..schemas.vault import (
    BUNDLE_FORMAT,
    GENESIS_HASH,
    EvidenceClipIn,
    EvidenceClipOut,
    EvidenceIn,
    EvidenceOut,
    VaultHead,
    VaultMetaBody,
    VaultMetaOut,
    VerifyRequest,
    VerifyResult,
)
from ..security import SessionCtx, current_session
from ..services import audit
from ..services.chain import SCOPE_NOTE, entry_hash, payload_hash, verify_chain
from ..utils.time import iso_z, utcnow

router = APIRouter(prefix="/api/vault", tags=["vault"])


def _meta(db: Session, session: SessionCtx) -> VaultMeta | None:
    return db.get(VaultMeta, (session.user_id, session.duress))


def _head(db: Session, session: SessionCtx) -> VaultHead:
    last = db.scalars(
        select(EvidenceChainEntry)
        .where(EvidenceChainEntry.user_id == session.user_id, EvidenceChainEntry.decoy.is_(session.duress))
        .order_by(EvidenceChainEntry.seq.desc())
    ).first()
    return VaultHead(seq=last.seq, hash=last.entry_hash) if last else VaultHead(seq=0, hash=GENESIS_HASH)


def _out(link: EvidenceChainEntry, item: EvidenceItem) -> EvidenceOut:
    return EvidenceOut(
        id=item.id,
        seq=link.seq,
        prev_hash=link.prev_hash,
        iv=item.iv,
        ciphertext=item.ciphertext,
        payload_hash=link.payload_hash,
        entry_hash=link.entry_hash,
        created_at=item.created_at,
    )


def _evidence(db: Session, session: SessionCtx) -> list[EvidenceOut]:
    rows = db.execute(
        select(EvidenceChainEntry, EvidenceItem)
        .join(EvidenceItem, EvidenceItem.id == EvidenceChainEntry.evidence_id)
        .where(EvidenceChainEntry.user_id == session.user_id, EvidenceChainEntry.decoy.is_(session.duress))
        .order_by(EvidenceChainEntry.seq)
    ).all()
    return [_out(link, item) for link, item in rows]


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
    db.add(VaultMeta(user_id=session.user_id, decoy=session.duress, **body.model_dump()))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "already configured")
    return {"configured": True}


@router.get("/head", response_model=VaultHead)
def get_head(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> VaultHead:
    return _head(db, session)


@router.get("/evidence", response_model=list[EvidenceOut])
def list_evidence(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)):
    return _evidence(db, session)


@router.post("/evidence", response_model=EvidenceOut, status_code=status.HTTP_201_CREATED)
def append_evidence(
    body: EvidenceIn, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> EvidenceOut:
    """Append-only: there is deliberately no way to edit or delete one entry."""
    if _meta(db, session) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vault not configured")
    head = _head(db, session)
    if body.seq != head.seq + 1 or body.prev_hash != head.hash:
        raise HTTPException(status.HTTP_409_CONFLICT, "not at chain head")
    if body.entry_hash != entry_hash(body.seq, body.prev_hash, body.iv, body.ciphertext):
        raise HTTPException(422, "hash mismatch")

    now = utcnow()
    item = EvidenceItem(
        user_id=session.user_id, decoy=session.duress, iv=body.iv, ciphertext=body.ciphertext, created_at=now
    )
    db.add(item)
    db.flush()
    link = EvidenceChainEntry(
        evidence_id=item.id,
        user_id=session.user_id,
        decoy=session.duress,
        seq=body.seq,
        prev_hash=body.prev_hash,
        payload_hash=payload_hash(body.iv, body.ciphertext),
        entry_hash=body.entry_hash,
        created_at=now,
    )
    db.add(link)
    if not session.duress:
        audit.record(db, audit.EVIDENCE_ADDED, session.user_id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "not at chain head")
    return _out(link, item)


@router.get("/export")
def export_bundle(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)) -> dict:
    """The whole vault as one self-describing file: ciphertext plus what is needed to check the chain.

    Still encrypted. It can be verified with tools/verify_bundle.py, and only opened with the passphrase.
    """
    meta = _meta(db, session)
    if meta is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vault not configured")
    entries = _evidence(db, session)
    return {
        "format": BUNDLE_FORMAT,
        "exported_at": iso_z(utcnow()),
        "kdf": {"name": "PBKDF2-SHA256", "salt": meta.salt, "iterations": meta.iterations},
        "cipher": "AES-256-GCM",
        "verifier": {"iv": meta.verifier_iv, "ciphertext": meta.verifier_ct},
        "entries": [
            {
                "id": e.id,
                "seq": e.seq,
                "prev_hash": e.prev_hash,
                "iv": e.iv,
                "ciphertext": e.ciphertext,
                "payload_hash": e.payload_hash,
                "entry_hash": e.entry_hash,
                "created_at": iso_z(e.created_at),
            }
            for e in entries
        ],
        "head_hash": entries[-1].entry_hash if entries else GENESIS_HASH,
        "count": len(entries),
    }


def verify_result(bundle: dict) -> VerifyResult:
    problems = verify_chain(bundle)
    entries = bundle.get("entries") if isinstance(bundle, dict) else None
    return VerifyResult(
        valid=not problems,
        count=len(entries) if isinstance(entries, list) else 0,
        head_hash=bundle.get("head_hash") if isinstance(bundle.get("head_hash"), str) else None,
        problems=problems,
        scope=SCOPE_NOTE,
    )


@router.post("/verify", response_model=VerifyResult)
def verify_bundle(body: VerifyRequest, _: SessionCtx = Depends(current_session)) -> VerifyResult:
    """Checks an exported bundle exactly as given. Nothing in it is trusted, stored or compared to the server's copy."""
    return verify_result(body.bundle)


@router.get("/clips", response_model=list[EvidenceClipOut])
def list_clips(session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)):
    clips = db.scalars(
        select(EvidenceClip)
        .where(EvidenceClip.user_id == session.user_id, EvidenceClip.decoy.is_(session.duress))
        .order_by(EvidenceClip.created_at)
    ).all()
    return [EvidenceClipOut(id=c.id, iv=c.iv, ciphertext=c.ciphertext, wrapped_key=c.wrapped_key) for c in clips]


@router.post("/clips", status_code=status.HTTP_201_CREATED)
def add_clip(
    body: EvidenceClipIn, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> dict[str, bool]:
    """Audio captured during an SOS, sealed to the vault's public key while the vault is locked.

    Discarded under duress: it would otherwise appear in the decoy vault, where the person
    forcing the unlock could play it. The reply is the same either way.
    """
    if session.duress:
        return {"accepted": True}
    if _meta(db, session) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vault not configured")
    db.add(EvidenceClip(user_id=session.user_id, decoy=session.duress, **body.model_dump()))
    db.commit()
    return {"accepted": True}


@router.delete("/clips/{clip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_clip(
    clip_id: str, session: SessionCtx = Depends(current_session), db: Session = Depends(get_db)
) -> Response:
    """Removes a clip from the holding area once the device has moved it into the chain."""
    clip = db.get(EvidenceClip, clip_id)
    if clip is None or clip.user_id != session.user_id or clip.decoy != session.duress:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    db.delete(clip)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
