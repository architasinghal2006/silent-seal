"""The evidence hash chain: what links entries together and how a bundle is checked.

    payload_hash = SHA-256(iv | ciphertext)
    entry_hash   = SHA-256(seq | prev_hash | iv | ciphertext)

Entry 1 links to GENESIS, and every later entry carries the hash of the one before it.

What a passing check proves: no entry was altered, reordered or removed from the middle.
What it does not prove: that the newest entries are all present, that device timestamps are
true, or that any event actually happened. It is integrity checking, not proof of events.

tools/verify_bundle.py repeats this logic so it can run with no access to this code. A test
keeps the two in step.
"""

import hashlib

GENESIS_HASH = "0" * 64
BUNDLE_FORMAT = "ssv1"
SCOPE_NOTE = (
    "This checks that the record was not altered, reordered or cut from the middle. "
    "It does not prove that an event happened, and it cannot detect removal of the newest entries."
)


def payload_hash(iv: str, ciphertext: str) -> str:
    return hashlib.sha256(f"{iv}|{ciphertext}".encode()).hexdigest()


def entry_hash(seq: int, prev_hash: str, iv: str, ciphertext: str) -> str:
    """Must match entryHash in frontend/src/crypto/vaultCrypto.ts and tools/verify_bundle.py."""
    return hashlib.sha256(f"{seq}|{prev_hash}|{iv}|{ciphertext}".encode()).hexdigest()


def _problem(kind: str, position: int | None, detail: str) -> dict:
    return {"kind": kind, "position": position, "detail": detail}


def verify_chain(bundle: object) -> list[dict]:
    """Every problem found, in order. An empty list means the chain is intact.

    Kinds: unreadable, missing, broken_link, modified, head_mismatch, count_mismatch.
    """
    try:
        if not isinstance(bundle, dict) or bundle.get("format") != BUNDLE_FORMAT:
            return [_problem("unreadable", None, "not an evidence bundle in the ssv1 format")]
        entries = bundle["entries"]
        if not isinstance(entries, list):
            raise TypeError("entries must be a list")

        problems: list[dict] = []
        previous_hash = GENESIS_HASH
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

            recomputed = entry_hash(seq, entry["prev_hash"], entry["iv"], entry["ciphertext"])
            stored_payload = entry.get("payload_hash")
            if recomputed != entry["entry_hash"] or (
                stored_payload is not None and stored_payload != payload_hash(entry["iv"], entry["ciphertext"])
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
