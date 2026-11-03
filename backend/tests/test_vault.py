import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.routers.vault import entry_hash
from app.schemas import GENESIS_HASH

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
    r = client.post("/api/auth/unlock", json={"account_id": account, "pin": pin})
    return {"Authorization": f"Bearer {r.json()['token']}"}


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
    for path in ("meta", "head", "entries", "clips"):
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
    assert client.post("/api/vault/entries", json=_entry(), headers=headers).status_code == 409


def test_chain_grows_in_order(client, real):
    assert client.get("/api/vault/head", headers=real).json() == {"seq": 0, "hash": GENESIS_HASH}
    first = _entry()
    assert client.post("/api/vault/entries", json=first, headers=real).status_code == 201
    second = _entry(2, first["entry_hash"])
    assert client.post("/api/vault/entries", json=second, headers=real).status_code == 201

    assert client.get("/api/vault/head", headers=real).json() == {"seq": 2, "hash": second["entry_hash"]}
    assert [e["seq"] for e in client.get("/api/vault/entries", headers=real).json()] == [1, 2]


@pytest.mark.parametrize(
    "bad",
    [
        {"seq": 2},
        {"prev_hash": "a" * 64},
    ],
)
def test_entry_not_at_head_is_refused(client, real, bad):
    body = _entry(bad.get("seq", 1), bad.get("prev_hash", GENESIS_HASH))
    assert client.post("/api/vault/entries", json=body, headers=real).status_code == 409


def test_replayed_entry_is_refused(client, real):
    client.post("/api/vault/entries", json=_entry(), headers=real)
    assert client.post("/api/vault/entries", json=_entry(), headers=real).status_code == 409


def test_wrong_hash_is_refused(client, real):
    body = {**_entry(), "entry_hash": "b" * 64}
    assert client.post("/api/vault/entries", json=body, headers=real).status_code == 422


@pytest.mark.parametrize(
    "field,value",
    [("iv", "not base64!"), ("iv", B64), ("ciphertext", "not base64!"), ("prev_hash", "short")],
)
def test_malformed_entry_is_refused(client, real, field, value):
    assert client.post("/api/vault/entries", json={**_entry(), field: value}, headers=real).status_code == 422


def test_entries_cannot_be_edited_or_deleted(client, real):
    client.post("/api/vault/entries", json=_entry(), headers=real)
    assert client.delete("/api/vault/entries/1", headers=real).status_code == 404  # no such route
    assert client.put("/api/vault/entries", json=_entry(), headers=real).status_code == 405


def test_duress_vault_is_empty_and_separate(client, account, real):
    client.post("/api/vault/entries", json=_entry(), headers=real)
    client.post("/api/vault/clips", json=CLIP, headers=real)
    duress = _auth(client, account, "9876")

    assert client.get("/api/vault/meta", headers=duress).json()["configured"] is False
    assert client.get("/api/vault/entries", headers=duress).json() == []
    assert client.get("/api/vault/clips", headers=duress).json() == []
    assert client.get("/api/vault/head", headers=duress).json()["seq"] == 0

    # A vault created under duress is its own chain and leaves the real one untouched.
    assert client.put("/api/vault/meta", json=META, headers=duress).status_code == 201
    assert client.post("/api/vault/entries", json=_entry(ciphertext=base64.b64encode(b"decoy").decode()), headers=duress).status_code == 201
    assert client.get("/api/vault/entries", headers=duress).json()[0]["ciphertext"] != B64
    assert client.get("/api/vault/entries", headers=real).json()[0]["ciphertext"] == B64


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
    client.post("/api/vault/entries", json=_entry(), headers=real)
    other = client.post("/api/auth/setup", json={"real_pin": "4321", "duress_pin": "8765"}).json()["account_id"]
    theirs = _auth(client, other, "4321")
    assert client.get("/api/vault/meta", headers=theirs).json()["configured"] is False
    assert client.get("/api/vault/entries", headers=theirs).json() == []


# ---------- standalone bundle verifier ----------

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


def test_verifier_and_server_agree_on_the_hash():
    entry = _entry()
    assert verify_bundle.entry_hash(entry) == entry["entry_hash"]


def test_verifier_passes_an_intact_bundle(tmp_path):
    bundle = _bundle()
    assert verify_bundle.check_chain(bundle) is None
    assert verify_bundle.decrypt_all(bundle, PASSPHRASE, tmp_path) is None
    assert json.loads((tmp_path / "entry-0002.json").read_text())["text"] == "note 2"


def test_verifier_rejects_wrong_passphrase():
    assert verify_bundle.decrypt_all(_bundle(), "not the passphrase", None) == "wrong passphrase"


def _flip(text):
    raw = bytearray(base64.b64decode(text))
    raw[0] ^= 1
    return base64.b64encode(bytes(raw)).decode()


def test_verifier_catches_edited_ciphertext():
    bundle = _bundle()
    bundle["entries"][1]["ciphertext"] = _flip(bundle["entries"][1]["ciphertext"])
    assert "entry 2" in verify_bundle.check_chain(bundle)


def test_verifier_catches_removed_middle_entry():
    bundle = _bundle()
    del bundle["entries"][1]
    bundle["count"] = 2
    assert verify_bundle.check_chain(bundle) is not None


def test_verifier_catches_swapped_entries():
    bundle = _bundle()
    bundle["entries"][0], bundle["entries"][1] = bundle["entries"][1], bundle["entries"][0]
    assert verify_bundle.check_chain(bundle) is not None


def test_recomputed_chain_still_fails_decryption():
    """Rewriting every hash passes the chain, but the sealed position exposes the forgery."""
    bundle = copy.deepcopy(_bundle())
    bundle["entries"][1]["ciphertext"] = _flip(bundle["entries"][1]["ciphertext"])
    previous = bundle["entries"][0]["entry_hash"]
    for entry in bundle["entries"][1:]:
        entry["prev_hash"] = previous
        entry["entry_hash"] = verify_bundle.entry_hash(entry)
        previous = entry["entry_hash"]
    bundle["head_hash"] = previous

    assert verify_bundle.check_chain(bundle) is None
    assert "entry 2" in verify_bundle.decrypt_all(bundle, PASSPHRASE, None)
