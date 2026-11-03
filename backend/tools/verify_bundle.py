#!/usr/bin/env python3
"""Check an exported evidence bundle without the app or the server.

  python verify_bundle.py bundle.json                      check the hash chain (standard library only)
  python verify_bundle.py bundle.json --passphrase "..."   also decrypt every entry (needs `cryptography`)
  python verify_bundle.py bundle.json --passphrase "..." --out DIR   also save entries to DIR

Exit code 0 means every check passed. A failed check names the first bad entry.

What this proves: entries were not altered, reordered or removed from the middle, and with
the passphrase, that they were sealed by whoever held it. It cannot detect removal of the
newest entries, and timestamps come from the device, so they are not independent proof of time.
"""

import argparse
import base64
import getpass
import hashlib
import json
import sys
from pathlib import Path

GENESIS = "0" * 64
VERIFIER_AAD = b"verifier"


def entry_hash(entry: dict) -> str:
    text = f"{entry['seq']}|{entry['prev_hash']}|{entry['iv']}|{entry['ciphertext']}"
    return hashlib.sha256(text.encode()).hexdigest()


def check_chain(bundle: dict) -> str | None:
    """Returns a description of the first problem, or None if the chain is intact."""
    entries = bundle["entries"]
    previous = GENESIS
    for position, entry in enumerate(entries, start=1):
        if entry["seq"] != position:
            return f"entry {position}: expected sequence {position}, found {entry['seq']}"
        if entry["prev_hash"] != previous:
            return f"entry {position}: does not link to the entry before it"
        if entry_hash(entry) != entry["entry_hash"]:
            return f"entry {position}: contents do not match its hash"
        previous = entry["entry_hash"]
    if bundle["head_hash"] != previous:
        return "the bundle's final hash does not match its last entry"
    if bundle["count"] != len(entries):
        return f"the bundle says {bundle['count']} entries but contains {len(entries)}"
    return None


def decrypt_all(bundle: dict, passphrase: str, out: Path | None) -> str | None:
    try:
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        return "decrypting needs the `cryptography` package: pip install cryptography"

    kdf = bundle["kdf"]
    key = hashlib.pbkdf2_hmac(
        "sha256", passphrase.encode(), base64.b64decode(kdf["salt"]), kdf["iterations"], dklen=32
    )
    aes = AESGCM(key)
    verifier = bundle["verifier"]
    try:
        aes.decrypt(base64.b64decode(verifier["iv"]), base64.b64decode(verifier["ciphertext"]), VERIFIER_AAD)
    except InvalidTag:
        return "wrong passphrase"

    if out:
        out.mkdir(parents=True, exist_ok=True)
    for entry in bundle["entries"]:
        aad = f"{entry['seq']}|{entry['prev_hash']}".encode()
        try:
            plain = aes.decrypt(base64.b64decode(entry["iv"]), base64.b64decode(entry["ciphertext"]), aad)
        except InvalidTag:
            return f"entry {entry['seq']}: failed authenticated decryption, so it was altered or moved"
        if out:
            (out / f"entry-{entry['seq']:04d}.json").write_bytes(plain)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify an exported evidence bundle.")
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--passphrase", help="decrypt too. This can end up in your shell history, so --ask is safer")
    parser.add_argument("--ask", action="store_true", help="prompt for the passphrase instead of passing it")
    parser.add_argument("--out", type=Path, help="save decrypted entries to this folder")
    args = parser.parse_args()

    try:
        bundle = json.loads(args.bundle.read_text(encoding="utf-8"))
        if bundle.get("format") != "ssv1":
            raise ValueError("unknown format")
        problem = check_chain(bundle)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"FAILED: not a readable bundle ({error})")
        return 2
    if problem:
        print(f"FAILED: {problem}")
        return 1
    print(f"Chain intact: {bundle['count']} entries, final hash {bundle['head_hash']}")

    passphrase = getpass.getpass("Passphrase: ") if args.ask else args.passphrase
    if passphrase:
        problem = decrypt_all(bundle, passphrase, args.out)
        if problem:
            print(f"FAILED: {problem}")
            return 1
        print(f"Decrypted: all {bundle['count']} entries authenticated")
        if args.out:
            print(f"Saved to {args.out}. These files are NOT encrypted, so keep them safe.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
