import base64
import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from sqlalchemy import select

from app.database import SessionLocal
from app.models import EvidenceChainEntry, EvidenceItem
from app.services.chain import GENESIS_HASH, entry_hash, payload_hash, verify_chain

_spec = importlib.util.spec_from_file_location(
    "verify_bundle", Path(__file__).resolve().parent.parent / "tools" / "verify_bundle.py"
)
verify_bundle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(verify_bundle)

B64 = base64.b64encode(b"opaque").decode()
IV = base64.b64encode(b"x" * 12).decode()
META = {
    "salt": base64.b64encode(b"s" * 16).decode(),
    "iterations": 600000,
    "verifier_iv": IV,
    "verifier_ct": B64,
    "public_key": '{"kty":"RSA"}',
    "private_iv": IV,
    "private_ct": B64,
}
CLIP = {"iv": IV, "ciphertext": B64, "wrapped_key": B64}


def _auth(client, account, pin):
    r = client.post("/api/auth/unlock", json={"user_id": account, "pin": pin})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _kinds(problems):
    return [p["kind"] for p in problems]


def _entry(seq=1, prev=GENESIS_HASH, ciphertext=B64):
    return {
        "seq": seq,
        "prev_hash": prev,
        "iv": IV,
        "ciphertext": ciphertext,
        "entry_hash": entry_hash(seq, prev, IV, ciphertext),
    }


@pytest.fixture()
def real(client, account):
    headers = _auth(client, account, "1234")
    assert client.put("/api/vault/meta", json=META, headers=headers).status_code == 201
    return headers


def test_vault_requires_a_session(client):
    for path in ("meta", "head", "evidence", "clips", "export"):
        assert client.get(f"/api/vault/{path}").status_code == 401


def test_meta_can_only_be_set_once(client, real):
    meta = client.get("/api/vault/meta", headers=real).json()
    assert meta["configured"] is True and meta["iterations"] == 600000
    assert client.put("/api/vault/meta", json=META, headers=real).status_code == 409


def test_weak_kdf_is_rejected(client, account):
    headers = _auth(client, account, "1234")
    assert client.put("/api/vault/meta", json={**META, "iterations": 1000}, headers=headers).status_code == 422


def test_entries_cannot_be_added_before_setup(client, account):
    headers = _auth(client, account, "1234")
    assert client.post("/api/vault/evidence", json=_entry(), headers=headers).status_code == 409


def test_chain_grows_in_order(client, real):
    assert client.get("/api/vault/head", headers=real).json() == {"seq": 0, "hash": GENESIS_HASH}
    first = _entry()
    assert client.post("/api/vault/evidence", json=first, headers=real).status_code == 201
    second = _entry(2, first["entry_hash"])
    assert client.post("/api/vault/evidence", json=second, headers=real).status_code == 201

    assert client.get("/api/vault/head", headers=real).json() == {"seq": 2, "hash": second["entry_hash"]}
    assert [e["seq"] for e in client.get("/api/vault/evidence", headers=real).json()] == [1, 2]


@pytest.mark.parametrize(
    "bad",
    [
        {"seq": 2},
        {"prev_hash": "a" * 64},
    ],
)
def test_entry_not_at_head_is_refused(client, real, bad):
    body = _entry(bad.get("seq", 1), bad.get("prev_hash", GENESIS_HASH))
    assert client.post("/api/vault/evidence", json=body, headers=real).status_code == 409


def test_replayed_entry_is_refused(client, real):
    client.post("/api/vault/evidence", json=_entry(), headers=real)
    assert client.post("/api/vault/evidence", json=_entry(), headers=real).status_code == 409


def test_wrong_hash_is_refused(client, real):
    body = {**_entry(), "entry_hash": "b" * 64}
    assert client.post("/api/vault/evidence", json=body, headers=real).status_code == 422


@pytest.mark.parametrize(
    "field,value",
    [("iv", "not base64!"), ("iv", B64), ("ciphertext", "not base64!"), ("prev_hash", "short")],
)
def test_malformed_entry_is_refused(client, real, field, value):
    assert client.post("/api/vault/evidence", json={**_entry(), field: value}, headers=real).status_code == 422


def test_entries_cannot_be_edited_or_deleted(client, real):
    client.post("/api/vault/evidence", json=_entry(), headers=real)
    assert client.delete("/api/vault/evidence/1", headers=real).status_code == 404  # no such route
    assert client.put("/api/vault/evidence", json=_entry(), headers=real).status_code == 405


def test_duress_vault_is_empty_and_separate(client, account, real):
    client.post("/api/vault/evidence", json=_entry(), headers=real)
    client.post("/api/vault/clips", json=CLIP, headers=real)
    duress = _auth(client, account, "9876")

    assert client.get("/api/vault/meta", headers=duress).json()["configured"] is False
    assert client.get("/api/vault/evidence", headers=duress).json() == []
    assert client.get("/api/vault/clips", headers=duress).json() == []
    assert client.get("/api/vault/head", headers=duress).json()["seq"] == 0

    # A vault created under duress is its own chain and leaves the real one untouched.
    assert client.put("/api/vault/meta", json=META, headers=duress).status_code == 201
    assert client.post("/api/vault/evidence", json=_entry(ciphertext=base64.b64encode(b"decoy").decode()), headers=duress).status_code == 201
    assert client.get("/api/vault/evidence", headers=duress).json()[0]["ciphertext"] != B64
    assert client.get("/api/vault/evidence", headers=real).json()[0]["ciphertext"] == B64


def test_clip_sent_under_duress_is_discarded_with_the_same_reply(client, account, real):
    duress = _auth(client, account, "9876")
    client.put("/api/vault/meta", json=META, headers=duress)
    sent = client.post("/api/vault/clips", json=CLIP, headers=duress)
    assert sent.status_code == 201 and sent.json() == {"accepted": True}
    assert client.get("/api/vault/clips", headers=duress).json() == []
    assert client.get("/api/vault/clips", headers=real).json() == []


def test_duress_cannot_delete_a_real_clip(client, account, real):
    client.post("/api/vault/clips", json=CLIP, headers=real)
    clip_id = client.get("/api/vault/clips", headers=real).json()[0]["id"]
    duress = _auth(client, account, "9876")
    assert client.delete(f"/api/vault/clips/{clip_id}", headers=duress).status_code == 404
    assert client.delete(f"/api/vault/clips/{clip_id}", headers=real).status_code == 204
    assert client.get("/api/vault/clips", headers=real).json() == []


def test_vaults_are_isolated_between_accounts(client, real):
    client.post("/api/vault/evidence", json=_entry(), headers=real)
    other = client.post("/api/auth/setup", json={"real_pin": "4321", "duress_pin": "8765"}).json()["user_id"]
    theirs = _auth(client, other, "4321")
    assert client.get("/api/vault/meta", headers=theirs).json()["configured"] is False
    assert client.get("/api/vault/evidence", headers=theirs).json() == []


# ---------- stored form, export and server-side verification ----------


def test_server_stores_only_ciphertext_and_chain_metadata(client, account, real):
    client.post("/api/vault/evidence", json=_entry(), headers=real)
    with SessionLocal() as db:
        item = db.scalars(select(EvidenceItem).where(EvidenceItem.user_id == account)).one()
        link = db.scalars(select(EvidenceChainEntry).where(EvidenceChainEntry.user_id == account)).one()
    # Nothing but opaque ciphertext, its nonce and a timestamp: no type, text, location or passphrase.
    assert {c.name for c in EvidenceItem.__table__.columns} == {"id", "user_id", "decoy", "iv", "ciphertext", "created_at"}
    assert item.ciphertext == B64
    assert link.evidence_id == item.id and link.seq == 1 and link.prev_hash == GENESIS_HASH
    assert link.payload_hash == payload_hash(IV, B64)


def test_export_is_a_verifiable_encrypted_bundle(client, real):
    first = _entry()
    client.post("/api/vault/evidence", json=first, headers=real)
    client.post("/api/vault/evidence", json=_entry(2, first["entry_hash"]), headers=real)

    bundle = client.get("/api/vault/export", headers=real).json()
    assert bundle["format"] == "ssv1" and bundle["count"] == 2 and bundle["cipher"] == "AES-256-GCM"
    assert bundle["kdf"] == {"name": "PBKDF2-SHA256", "salt": META["salt"], "iterations": 600000}
    assert set(bundle["entries"][0]) == {"id", "seq", "prev_hash", "iv", "ciphertext", "payload_hash", "entry_hash", "created_at"}
    assert verify_chain(bundle) == [] and verify_bundle.check_chain(bundle) == []

    verdict = client.post("/api/vault/verify", json={"bundle": bundle}, headers=real).json()
    assert verdict["valid"] is True and verdict["count"] == 2 and verdict["problems"] == []
    assert "does not prove that an event happened" in verdict["scope"]


def test_export_before_setup_and_verify_without_a_session_are_refused(client, account):
    headers = _auth(client, account, "1234")
    assert client.get("/api/vault/export", headers=headers).status_code == 409
    assert client.post("/api/vault/verify", json={"bundle": {}}).status_code == 401


def test_verify_endpoint_reports_a_modified_entry(client, real):
    first = _entry()
    client.post("/api/vault/evidence", json=first, headers=real)
    client.post("/api/vault/evidence", json=_entry(2, first["entry_hash"]), headers=real)
    bundle = client.get("/api/vault/export", headers=real).json()
    bundle["entries"][0]["ciphertext"] = _flip(bundle["entries"][0]["ciphertext"])

    verdict = client.post("/api/vault/verify", json={"bundle": bundle}, headers=real).json()
    assert verdict["valid"] is False
    assert [(p["kind"], p["position"]) for p in verdict["problems"]] == [("modified", 1)]


def test_duress_export_never_contains_real_evidence(client, account, real):
    client.post("/api/vault/evidence", json=_entry(), headers=real)
    duress = _auth(client, account, "9876")
    assert client.get("/api/vault/export", headers=duress).status_code == 409
    client.put("/api/vault/meta", json=META, headers=duress)
    assert client.get("/api/vault/export", headers=duress).json()["entries"] == []


# ---------- chain verification: the service and the standalone tool ----------

PASSPHRASE = "correct horse battery"


def _bundle(count=3):
    salt = b"s" * 16
    iterations = 100000
    aes = AESGCM(hashlib.pbkdf2_hmac("sha256", PASSPHRASE.encode(), salt, iterations, dklen=32))
    b64 = lambda raw: base64.b64encode(raw).decode()  # noqa: E731
    entries, previous = [], GENESIS_HASH
    for seq in range(1, count + 1):
        iv = bytes([seq]) * 12
        sealed = aes.encrypt(iv, json.dumps({"text": f"note {seq}"}).encode(), f"{seq}|{previous}".encode())
        entry = {"seq": seq, "prev_hash": previous, "iv": b64(iv), "ciphertext": b64(sealed)}
        entry["payload_hash"] = verify_bundle.payload_hash(entry)
        entry["entry_hash"] = verify_bundle.entry_hash(entry)
        previous = entry["entry_hash"]
        entries.append(entry)
    verifier_iv = b"v" * 12
    return {
        "format": "ssv1",
        "kdf": {"name": "PBKDF2-SHA256", "salt": b64(salt), "iterations": iterations},
        "verifier": {"iv": b64(verifier_iv), "ciphertext": b64(aes.encrypt(verifier_iv, b"ssv1", b"verifier"))},
        "entries": entries,
        "head_hash": previous,
        "count": count,
    }


def _flip(text):
    raw = bytearray(base64.b64decode(text))
    raw[0] ^= 1
    return base64.b64encode(bytes(raw)).decode()


def _edited():
    bundle = _bundle()
    bundle["entries"][1]["ciphertext"] = _flip(bundle["entries"][1]["ciphertext"])
    return bundle


def _removed_middle():
    bundle = _bundle()
    del bundle["entries"][1]
    bundle["count"] = 2
    return bundle


def _removed_and_renumbered():
    bundle = _removed_middle()
    bundle["entries"][1]["seq"] = 2
    return bundle


def _swapped():
    bundle = _bundle()
    bundle["entries"][0], bundle["entries"][1] = bundle["entries"][1], bundle["entries"][0]
    return bundle


def _relinked():
    """An edit hidden by recomputing that entry's own hash. The next entry no longer links to it."""
    bundle = _edited()
    entry = bundle["entries"][1]
    entry["payload_hash"] = verify_bundle.payload_hash(entry)
    entry["entry_hash"] = verify_bundle.entry_hash(entry)
    return bundle


def _wrong_count():
    bundle = _bundle()
    bundle["count"] = 5
    return bundle


def _wrong_head():
    bundle = _bundle()
    bundle["head_hash"] = "f" * 64
    return bundle


CASES = {
    "intact": (_bundle, []),
    "empty": (lambda: _bundle(0), []),
    "edited ciphertext": (_edited, ["modified"]),
    "removed middle entry": (_removed_middle, ["missing"]),
    "removed and renumbered": (_removed_and_renumbered, ["broken_link", "modified"]),
    "relinked after edit": (_relinked, ["broken_link"]),
    "wrong count": (_wrong_count, ["count_mismatch"]),
    "wrong final hash": (_wrong_head, ["head_mismatch"]),
    "not a bundle": (lambda: {"format": "other"}, ["unreadable"]),
    "missing fields": (lambda: {"format": "ssv1", "entries": [{}]}, ["unreadable"]),
    "not even an object": (lambda: ["nope"], ["unreadable"]),
}


@pytest.mark.parametrize("name", CASES)
def test_service_and_standalone_tool_reach_the_same_verdict(name):
    make, expected = CASES[name]
    from_service = verify_chain(make())
    from_tool = verify_bundle.check_chain(make())
    assert _kinds(from_service) == expected
    assert from_tool == from_service


def test_swapped_entries_are_caught_by_both():
    from_service = verify_chain(_swapped())
    assert from_service and from_service == verify_bundle.check_chain(_swapped())


def test_each_problem_names_the_entry():
    assert verify_chain(_edited())[0]["detail"].startswith("entry 2 was modified")
    assert verify_chain(_removed_middle())[0]["detail"] == "entry 2 is missing before entry 3"
    assert verify_chain(_relinked())[0]["detail"] == "entry 3 does not link to the entry before it"


def test_verifier_and_server_agree_on_the_hash():
    entry = _entry()
    assert verify_bundle.entry_hash(entry) == entry["entry_hash"]
    assert verify_bundle.payload_hash(entry) == payload_hash(entry["iv"], entry["ciphertext"])


def test_verifier_decrypts_an_intact_bundle(tmp_path):
    bundle = _bundle()
    assert verify_bundle.decrypt_all(bundle, PASSPHRASE, tmp_path) is None
    assert json.loads((tmp_path / "entry-0002.json").read_text())["text"] == "note 2"


def test_verifier_rejects_wrong_passphrase():
    assert verify_bundle.decrypt_all(_bundle(), "not the passphrase", None) == "wrong passphrase"


def test_recomputed_chain_still_fails_decryption():
    """Rewriting every hash passes the chain, but the sealed position exposes the forgery."""
    bundle = copy.deepcopy(_bundle())
    bundle["entries"][1]["ciphertext"] = _flip(bundle["entries"][1]["ciphertext"])
    previous = bundle["entries"][0]["entry_hash"]
    for entry in bundle["entries"][1:]:
        entry["prev_hash"] = previous
        entry["payload_hash"] = verify_bundle.payload_hash(entry)
        entry["entry_hash"] = verify_bundle.entry_hash(entry)
        previous = entry["entry_hash"]
    bundle["head_hash"] = previous

    assert verify_bundle.check_chain(bundle) == []
    assert "entry 2" in verify_bundle.decrypt_all(bundle, PASSPHRASE, None)


def test_command_line_tool_exit_codes(tmp_path):
    good, bad = tmp_path / "good.json", tmp_path / "bad.json"
    good.write_text(json.dumps(_bundle()), encoding="utf-8")
    bad.write_text(json.dumps(_edited()), encoding="utf-8")
    tool = str(Path(__file__).resolve().parent.parent / "tools" / "verify_bundle.py")

    ok = subprocess.run([sys.executable, tool, str(good)], capture_output=True, text=True)
    assert ok.returncode == 0 and "Chain intact: 3 entries" in ok.stdout

    failed = subprocess.run([sys.executable, tool, str(bad), "--json"], capture_output=True, text=True)
    assert failed.returncode == 1
    assert json.loads(failed.stdout)["problems"][0]["kind"] == "modified"

    assert subprocess.run([sys.executable, tool, str(tmp_path / "absent.json")], capture_output=True).returncode == 2
