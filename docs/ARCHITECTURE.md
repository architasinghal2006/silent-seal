# Architecture

## Overview

```
 Survivor's phone (PWA)                         Server (FastAPI)                 Trusted contact
┌──────────────────────────────┐          ┌──────────────────────────┐        ┌─────────────────┐
│ Calculator  ──sequence, PIN──┼─unlock──▶│ auth: scrypt, two hashes │        │                 │
│                              │◀─token───┤ same reply for both PINs │        │                 │
│ Safety app (in-memory router)│          │                          │        │                 │
│  SOS ────────────────────────┼─────────▶│ sos ─▶ notification      ├─alert─▶│ SMS / email     │
│  Location stream ────────────┼─────────▶│ live_share ─▶ points     │◀─link──┤ live map page   │
│  Vault: AES-256-GCM in       │          │                          │        │                 │
│   browser ──ciphertext only──┼─────────▶│ vault: items + hash chain│        └─────────────────┘
│  Zones watcher (Haversine)   │          │                          │
│  Offline queue (IndexedDB) ──┼──sync───▶│ offline_queue: idempotent│        Judge dashboard
│  Service worker (app shell)  │          │ SQLite / PostgreSQL      │──────▶ (demo servers only)
└──────────────────────────────┘          └──────────────────────────┘
```

One origin serves everything in production: the API also serves the built PWA, so there is no cross-origin traffic and the content policy can be strict.

## Frontend

React, Vite, TypeScript, Tailwind CSS v4. Design tokens live in `src/styles/index.css`; reusable components in `src/components/ui/`.

**Three stages.** `App.tsx` shows one of: the calculator, first-time setup, or the safety app. The last two are loaded lazily, so a phone only ever used as a calculator never runs their code.

**Navigation stays in memory.** The safety app uses React Router's memory router. The address bar and browser history never change, so neither can show that a vault or a map was opened, and a reload always lands on the calculator.

**Where state lives.**

| Kept in | What | Why |
|---|---|---|
| Memory only | Session token, vault keys, decrypted evidence, offline token in use | Gone on lock, reload or close |
| `localStorage`, under a key that looks like calculator preferences | User id, hash of the secret sequence, PIN-sealed offline records, watched zones, live-stream token, two preferences | Needed to work with no session or no connection. None is a credential on its own |
| IndexedDB | The offline queue | Survives reloads until the server confirms each item |

**Services that outlive the session.** Three loops keep running on the calculator with no session: the location stream (during a share), the zone watcher, and the queue. Each holds only a narrow token: one that can add points to one share, one that can send zone alerts, and one that can send queued events.

**Locking.** `lockSession()` drops everything in memory and revokes the token on the server. If an alert or a recording is still in flight, the revocation waits for it (`holdSession`), so locking never cuts off an SOS.

## Backend

FastAPI, SQLAlchemy 2, Pydantic 2. SQLite locally, PostgreSQL in production. Alembic migrations run on every start.

- `routers/` are thin: validate, call a service, shape the reply.
- `services/` hold the behaviour: recording and dispatching an SOS, live shares, the hash chain, erasing, demo data.
- `security/deps.py` is the only place identity is established. Routers receive a `SessionCtx(user_id, duress)` and never read a user id from a request.
- `middleware/` adds rate limiting and security headers to every response.

### Data model

| Table | Holds |
|---|---|
| `users`, `auth_credentials`, `profiles`, `revoked_tokens` | The account id (also the recovery code), scrypt hashes of both PINs and the lockout counter, the name shown in alerts, logged-out tokens |
| `contacts` | Trusted contacts, with relationship, emergency flag and a `decoy` flag |
| `sos_events`, `notification_records` | Each alert and each message sent for it, with the adapter that handled it |
| `live_share_sessions`, `location_points` | Shares and their trails |
| `vault_meta`, `evidence_items`, `evidence_chain_entries`, `evidence_clips` | Key-derivation parameters, ciphertext, the hash chain, and evidence sealed while the vault was locked |
| `zones` | Safe and danger zones with their preferences |
| `offline_queue_events` | Ids of queued events already handled, with a duplicate count |
| `audit_events` | A coarse trail of security-relevant actions |

## The two-PIN design

The property to hold: **nothing the phone receives, stores or shows reveals which PIN was used.**

- Both scrypt hashes are verified on every attempt, so timing doesn't depend on which matched. An unknown user id burns the same two verifications.
- Every failure is the same `401 {"detail": "invalid"}`: wrong PIN, unknown user, lockout.
- Both PINs get the same response shape. The token's scope claim is an opaque letter.
- The duress SOS is dispatched after the response is sent.
- **The client cannot tell the two apart, so it does the same work after every unlock**, including sending its location. The server keeps that location only if an SOS is in progress.
- Every "sided" table has a `decoy` flag. A duress session reads and writes only decoy rows: its own empty contacts, zones, vault and live share. Real rows answer 404.
- Things a duress session could use to cause harm are neutralised without looking different: "I'm safe" ends only the decoy share, erase clears only the decoy side, SOS audio is discarded.
- Offline, each PIN opens one of two same-sized sealed records holding an opaque token. The phone reports every offline unlock identically; the server decides from the token.

## Evidence vault

```
passphrase ──PBKDF2-SHA256, 600,000 rounds, random salt──▶ AES-256-GCM key (memory only)

entry n:   ciphertext = AES-GCM(key, random 96-bit nonce, envelope, aad = "n|prev_hash")
           payload_hash = SHA-256(nonce | ciphertext)
           entry_hash   = SHA-256(n | prev_hash | nonce | ciphertext)
           prev_hash    = entry_hash of entry n−1   (64 zeros for the first)
```

- The envelope (type, text, media, time, location) is entirely inside the ciphertext. The server sees no metadata beyond size and arrival time.
- The chain position is bound into the encryption as authenticated data. A server that rewrote every hash would still fail when the entry is decrypted.
- The server only accepts an entry that links to the current head, and has no endpoint to edit or delete one.
- Evidence captured while the vault is locked (SOS audio, anything added offline) is sealed to an RSA-OAEP public key and joins the chain the next time the vault opens.
- `services/chain.py` and the standalone `tools/verify_bundle.py` implement the same check. A test runs both over the same cases.

## Offline

- A service worker caches the app shell, so the calculator and the app load with no connection.
- Each queued item has an id, type, timestamp, payload, status and retry metadata. Retries back off from 5 seconds to 5 minutes.
- `POST /api/offline/sync` applies a batch in order and answers `applied`, `duplicate` or `rejected` for each id. The server records every id it has handled, so a resend after a lost reply does nothing.
- An item is removed from the phone only after the server answers for it. Nothing is shown as sent before that.

## Notifications

`NotificationAdapter` has one method, `send`, returning `sent`, `stub` or `failed`. `MockNotificationAdapter` is the default: it records and sends nothing. `EmailAdapter` sends over SMTP and `SmsAdapter` sends through Twilio (MSG91 remains a stub); both return `sent` only when the provider accepts the message. `LiveAdapter` routes each contact to the adapter for their channel. The adapter that carried each message is stored on its record and shown wherever a delivery is displayed.

## Deployment

One Docker image builds the PWA and serves it from the API. `render.yaml` describes a single Render web service with an external Postgres. HTTPS is required in production: browsers only allow geolocation, service workers and installation on secure origins.
