# Silent Seal

A covert personal-safety app for domestic-abuse survivors who may be living with the person threatening them. It installs and opens as a working **calculator**. A secret sequence and a PIN reveal the real app, where the survivor alone controls silent SOS alerts, live location sharing and an encrypted evidence vault.

Built for the SEVA Challenge 2026 as a working model. All data is demo data.

> Silent Seal complements emergency services and does not replace them or guarantee anyone's safety. In India: **112** Emergency Response Support System, **181** Women Helpline, **1098** Child Helpline. These are external public services.

## What it does

| | |
|---|---|
| **Disguised calculator** | A real calculator with its own parser (no `eval`). The survivor's own secret sequence, then `=`, turns the keypad into a PIN pad. The only hint is a small `M`. |
| **Two PINs** | The real PIN opens the app. The duress PIN opens an empty-looking copy and silently raises an SOS. The server's reply is the same for both, and a wrong PIN just shows as a number. |
| **Silent SOS** | A 2-second hold alerts the emergency contacts with location and battery, starts a live map, and returns to the calculator with nothing on screen. |
| **Live location** | A private, expiring link shows contacts the current position and trail. "I'm safe" ends it and tells them. |
| **Evidence vault** | Notes, photos and audio are encrypted in the browser with AES-256-GCM under a passphrase separate from the PIN. The server stores ciphertext only. Entries form a SHA-256 hash chain that can be checked without the app. |
| **Zones** | Safe and danger zones on a map, with entry and exit alerts, checked with the Haversine formula while the app is open. |
| **Offline** | The calculator, both PINs, alerts and new evidence work with no connection. Queued events are sent once when it returns. |
| **Quick exit and panic wipe** | Exit button, `Esc`, switching apps or 5 idle minutes lock the app. A 2-second hold wipes the app's data from the phone. |

## Run it locally

Needs Python 3.12+ and Node 20+.

```bash
# 1. Settings: copy the template, then set JWT_SECRET and DEMO_DASHBOARD_TOKEN
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"     # paste as JWT_SECRET

# 2. Backend  ->  http://localhost:8000/api/docs
cd backend
python -m venv .venv
.venv/Scripts/activate            # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# 3. Frontend  ->  http://localhost:5173   (proxies /api to :8000)
cd frontend
npm install
npm run dev
```

The database (SQLite by default) is created and migrated on first start. Open the calculator, type `1379` then `=`, and follow first-time setup. [docs/DEMO.md](docs/DEMO.md) walks through the six demonstration scenarios.

**Offline mode and install** need the built app, because service workers don't run under `npm run dev`:

```bash
cd frontend && npm run build && npm run preview      # http://localhost:4173
```

**Judge dashboard:** set `DEMO_DASHBOARD_TOKEN` in `.env`, restart the backend, and open http://localhost:8000/api/demo/dashboard.

## Tests

```bash
cd backend  && pytest -q       # 238 tests
cd frontend && npm test        # 110 tests
```

- **Backend** (pytest, FastAPI TestClient): setup, real and duress unlock, wrong PIN, lockout, logout, rate limits, contacts, SOS creation and status, notification adapters, live-share creation, expiry and decoy isolation, ciphertext-only storage, hash-chain verification (service and standalone tool agree on every case), Haversine, zones, offline sync and duplicate prevention, authorization on every route, erase, the demo tools, and migration of a pre-migration database with its data.
- **Frontend** (Vitest, React Testing Library): calculator, secret sequence, PIN entry, real vs decoy separation, lockout, SOS flow, contact management, vault encryption and decryption, geofence rules, offline queue with retry and backoff, quick exit, panic wipe, and whole journeys through the real app against a fake server.

## What is real and what is simulated

| Operational in this build | Simulated or stubbed |
|---|---|
| Calculator, secret sequence, two-PIN unlock, lockout, logout | **SMS and email delivery, by default.** The default `mock` adapter records each message for the judge dashboard and sends nothing, and the app labels it "Simulated: recorded, not sent". Real delivery is built in and off until configured: see below. |
| SOS events, location and battery capture | Simulated incoming alerts and their moving trail on the judge dashboard, always labelled. |
| Live-location links, expiry, "I'm safe" | Sample contacts, zones and history loaded from Settings on a demo server, always labelled. |
| Client-side AES-256-GCM, PBKDF2-SHA256 (600,000 rounds), hash chain, export, verification | |
| Geofence evaluation, offline unlock, offline queue, duplicate prevention | |
| Quick exit, idle lock, panic wipe | |

**Needs a native app:** location sharing, zone checks and queued sending while the app is closed or the phone is locked; hiding from the app switcher; blocking screenshots; a launcher icon that can't be inspected. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Sending real alerts

By default nothing leaves the server. To have contacts actually receive alerts, set these in `.env` (or in Render's **Environment** tab) and restart:

**Email (simplest, free).** With a Gmail account, turn on 2-Step Verification, then create an app password under Google Account > Security > App passwords.

```
NOTIFY_ADAPTER=live
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=the 16-character app password
```

**SMS (Twilio).** Create a Twilio account, get a phone number, and on a trial account verify each recipient's number under Phone Numbers > Verified Caller IDs.

```
NOTIFY_ADAPTER=live
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+1...        # your Twilio number
```

`live` reaches each contact by their own channel: SMS contacts through Twilio, email contacts over SMTP. With only one of the two configured, contacts on the other channel show as "Not sent".

Limits worth knowing:

- A message is marked **Sent** when the provider accepts it. That is not proof it reached the phone.
- A Twilio trial only texts verified numbers and adds a trial prefix to the text.
- SMS to Indian numbers from an unregistered sender is often blocked by carriers. Reliable SMS in India needs DLT registration of the sender and message template, through a provider such as MSG91 (still a stub here).
- `PUBLIC_BASE_URL` must be the public address of the server, or the live-map link in the message won't open on the contact's phone. On Render this is set automatically.

## Project layout

```
backend/
  app/
    main.py  config.py  database.py
    models/      user, contact, sos, live_share, vault, zone, offline, audit
    schemas/     one module per router
    routers/     auth, contacts, sos, live_share, vault, zones, offline_queue, demo, health
    services/    sos, live_share, erase, chain, audit, demo_seed, notifications/
    security/    pins (scrypt), tokens (JWT), deps (who is calling)
    middleware/  rate_limit, security_headers
    utils/       time, geo (Haversine)
    templates/   judge dashboard, contact's live map      static/  their scripts, Leaflet
  alembic/       schema migrations, applied on start
  tests/
  tools/verify_bundle.py     standalone evidence verifier (standard library only)
frontend/
  src/
    components/  ui/ (design system) and feature components
    pages/       Calculator, onboarding, Home, Contacts, Sos, LiveLocation, Zones, Vault, Settings, SyncStatus
    layouts/     AppShell, OnboardingLayout, SafetyApp (in-memory router)
    hooks/  contexts/  services/  crypto/  offline/  geolocation/  utils/  styles/  types/
docs/            ARCHITECTURE.md, THREAT_MODEL.md, DEMO.md
```

## API

| | |
|---|---|
| Authentication | `POST /api/auth/setup` · `POST /api/auth/unlock` · `POST /api/auth/logout` |
| Contacts | `GET` `POST /api/contacts` · `PUT` `DELETE /api/contacts/{id}` |
| SOS | `POST /api/sos` · `GET /api/sos/history` · `GET /api/sos/{id}` · `POST /api/sos/context` |
| Live location | `GET` `POST /api/live-share` · `POST /api/live-share/location` · `POST /api/live-share/stop` · `GET /api/live-share/{token}` |
| Vault | `GET` `POST /api/vault/evidence` · `GET /api/vault/export` · `POST /api/vault/verify` · `/api/vault/meta` `head` `clips` |
| Zones | `GET` `POST /api/zones` · `PUT` `DELETE /api/zones/{id}` |
| Offline | `POST /api/offline/sync` · `GET /api/offline/status` · `GET /api/offline/token` |
| Demo | `GET /api/demo/dashboard` · `GET /api/demo/alerts` · `POST /api/demo/simulate-sos` · `state` `seed` `verify` `sample` |
| Other | `GET /api/health` · `GET /api/me` · `GET` `PUT /api/profile` · `POST /api/account/erase` |

Interactive reference: `/api/docs`. The caller's identity always comes from the session token, never from the request body.

## Verify an evidence export without the app

```bash
cd backend
python tools/verify_bundle.py path/to/calc-history-DATE.json           # hash chain only, standard library
python tools/verify_bundle.py path/to/calc-history-DATE.json --ask     # also decrypt (needs `cryptography`)
```

It reports valid chains, modified entries, missing entries and broken links. A pass shows the record was not altered. It does not prove that an event happened.

## Deploy (Render + Neon)

The root `Dockerfile` builds the PWA and serves it from the backend, so the whole app is one service on one `https://` address. Phones need HTTPS for location, install and offline mode.

1. **Database:** create a free Postgres project at [neon.tech](https://neon.tech) and copy its connection string.
2. **Service:** in Render, choose **New > Blueprint** and pick this repo. `render.yaml` sets up the service. Paste the Neon string as `DATABASE_URL`.
3. `JWT_SECRET` and `DEMO_DASHBOARD_TOKEN` are generated for you. The token, under the service's **Environment** tab, opens `/api/demo/dashboard`.

Schema migrations run on every start, including the upgrade of a database created before migrations existed. The free plan sleeps after 15 idle minutes and takes about a minute to wake, so open the link before presenting. Keep the service name neutral: it is part of the address a survivor's phone would show.

Locally, `docker compose up --build` runs the API with Postgres, and `docker build -t silent-seal . && docker run -p 8000:8000 -e JWT_SECRET=dev silent-seal` runs the single-service image.

## More

- [docs/DEMO.md](docs/DEMO.md): the six demonstration scenarios, step by step
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit and why
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): what this defends against, what it doesn't, and the limits of a web app
