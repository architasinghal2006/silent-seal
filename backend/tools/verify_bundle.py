#!/usr/bin/env python3
"""Check an exported evidence bundle without the app or the server.

  python verify_bundle.py bundle.json                      check the hash chain (standard library only)
  python verify_bundle.py bundle.json --ask                also decrypt every entry (needs `cryptography`)
  python verify_bundle.py bundle.json --ask --out DIR      also save the decrypted entries to DIR
  python verify_bundle.py bundle.json --json               print the result as JSON

Exit code 0 means every check passed, 1 means a check failed, 2 means the file could not be read.

How entries are linked:

    payload_hash = SHA-256(iv | ciphertext)
    entry_hash   = SHA-256(seq | prev_hash | iv | ciphertext)

Entry 1 links to sixty-four zeros, and every later entry carries the hash of the one before it.

What a pass proves: no entry was altered, reordered or removed from the middle, and with the
passphrase, that every entry was sealed by whoever held it.

What it does not prove: that an event actually happened. This is integrity checking, not
proof of events. It also cannot detect removal of the newest entries, and the times and
locations inside entries come from the device, so they are not independent proof.

This file deliberately imports nothing from the app, so it can be handed to someone else
and run on its own.
"""

import argparse
import base64
import getpass
import hashlib
import json
import sys
from pathlib import Path

GENESIS = "0" * 64
FORMAT = "ssv1"
VERIFIER_AAD = b"verifier"


def payload_hash(entry: dict) -> str:
    return hashlib.sha256(f"{entry['iv']}|{entry['ciphertext']}".encode()).hexdigest()


def entry_hash(entry: dict) -> str:
    text = f"{entry['seq']}|{entry['prev_hash']}|{entry['iv']}|{entry['ciphertext']}"
    return hashlib.sha256(text.encode()).hexdigest()


def _problem(kind: str, position, detail: str) -> dict:
    return {"kind": kind, "position": position, "detail": detail}


def check_chain(bundle) -> list:
    """Every problem found, in order. An empty list means the chain is intact.

    Kinds:
      missing         an entry is absent from the middle of the chain
      broken_link     an entry does not link to the one before it, or is out of order
      modified        an entry's contents do not match its hash
      head_mismatch   the bundle's final hash is not its last entry's hash
      count_mismatch  the bundle's stated count is not the number of entries
      unreadable      the file is not an evidence bundle
    """
    try:
        if not isinstance(bundle, dict) or bundle.get("format") != FORMAT:
            return [_problem("unreadable", None, "not an evidence bundle in the ssv1 format")]
        entries = bundle["entries"]
        if not isinstance(entries, list):
            raise TypeError("entries must be a list")

        problems = []
        previous_hash = GENESIS
        expected_seq = 1
        for position, entry in enumerate(entries, start=1):
            seq = entry["seq"]
            gap = seq != expected_seq
            if gap:
                if isinstance(seq, int) and seq > expected_seq:
                    missing = f"{expected_seq}" if seq == expected_seq + 1 else f"{expected_seq} to {seq - 1}"
                    problems.append(_problem("missing", position, f"entry {missing} is missing before entry {seq}"))
                else:
                    problems.append(
                        _problem("broken_link", position, f"entry at position {position} has sequence {seq}, expected {expected_seq}")
                    )
            # A gap already explains why this entry doesn't link to the one before it.
            if entry["prev_hash"] != previous_hash and not gap:
                problems.append(_problem("broken_link", position, f"entry {seq} does not link to the entry before it"))

            stored_payload = entry.get("payload_hash")
            if entry_hash(entry) != entry["entry_hash"] or (
                stored_payload is not None and stored_payload != payload_hash(entry)
            ):
                problems.append(_problem("modified", position, f"entry {seq} was modified: its contents do not match its hash"))

            previous_hash = entry["entry_hash"]
            expected_seq = seq + 1 if isinstance(seq, int) else expected_seq + 1

        if bundle["head_hash"] != previous_hash:
            problems.append(_problem("head_mismatch", None, "the bundle's final hash does not match its last entry"))
        if bundle["count"] != len(entries):
            problems.append(
                _problem("count_mismatch", None, f"the bundle says {bundle['count']} entries but contains {len(entries)}")
            )
        return problems
    except (KeyError, TypeError, AttributeError) as error:
        return [_problem("unreadable", None, f"not a readable bundle ({error.__class__.__name__}: {error})")]


def decrypt_all(bundle: dict, passphrase: str, out):
    """Returns a description of the first failure, or None if every entry decrypted and authenticated."""
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
    parser.add_argument("--json", action="store_true", help="print the chain result as JSON")
    args = parser.parse_args()

    try:
        bundle = json.loads(args.bundle.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"FAILED: could not read the file ({error})")
        return 2

    problems = check_chain(bundle)
    if args.json:
        print(json.dumps({"valid": not problems, "problems": problems}, indent=2))
    if problems:
        if not args.json:
            print(f"FAILED: {len(problems)} problem(s) found")
            for problem in problems:
                print(f"  [{problem['kind']}] {problem['detail']}")
        return 2 if problems[0]["kind"] == "unreadable" else 1
    if not args.json:
        print(f"Chain intact: {bundle['count']} entries, final hash {bundle['head_hash']}")
        print("This shows the record was not altered. It does not prove that an event happened.")

    passphrase = getpass.getpass("Passphrase: ") if args.ask else args.passphrase
    if passphrase:
        failure = decrypt_all(bundle, passphrase, args.out)
        if failure:
            print(f"FAILED: {failure}")
            return 1
        print(f"Decrypted: all {bundle['count']} entries authenticated")
        if args.out:
            print(f"Saved to {args.out}. These files are NOT encrypted, so keep them safe.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
