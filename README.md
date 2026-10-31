# Silent Seal

A covert personal-safety PWA for domestic-abuse survivors who live with the perpetrator. It opens as a fully working **calculator**. A secret input sequence reveals the real app, where the survivor alone controls distress signals, location sharing and an encrypted evidence vault.

> This app complements, and does not replace, emergency services. In India: **112** emergency, **181** women's helpline, **1098** childline.

Hackathon working model. All data is dummy or demo data.

## Safety principles

- **Survivor-initiated only.** Nothing is shared unless the survivor acts, and only with contacts they add.
- **Plausible deniability.** The app installs as "Calculator" and works as one.
- **Duress PIN.** Opens an empty app *and* silently fires an SOS. The server response is identical to a real unlock.
- **Silent by default.** No sounds, toasts, vibration or notifications.
- **Encryption at rest** (Phase D). AES-256-GCM in the browser, with the key derived from a passphrase separate from the PIN.
- **Quick exit and auto-lock.** Exit button, `Esc`, switching away from the app and 5 minutes idle all return to the calculator and drop the in-memory session.

## Quick start (local, SQLite)

Prerequisites: Python 3.12+ and Node 20+.

```bash
# 1. Secrets: copy the template and fill in JWT_SECRET / POSTGRES_PASSWORD
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # paste as JWT_SECRET

# 2. Backend  ->  http://localhost:8000/api/docs
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# 3. Frontend  ->  http://localhost:5173  (proxies /api to :8000)
cd frontend
npm install
npm run dev
```

## Docker (backend + Postgres)

```bash
docker compose up --build        # API on http://localhost:8000, Postgres in a named volume
```

Then run the frontend with `npm run dev` as above. Compose reads `.env` and points `DATABASE_URL` at the `db` service.

## Demo walkthrough (Phase A)

1. Open http://localhost:5173. You see a normal calculator. Try `12+3×4=` and you get `24`.
2. Type `1379` and press `=` (`VITE_UNLOCK_SEQUENCE`). On first run this opens **First-time setup**. Choose a PIN (e.g. `2468`) and a different duress PIN (e.g. `1357`).
3. Back on the calculator, type `1379` and press `=`. A small **M** appears in the display, meaning hidden PIN mode. Type `2468` and press `=` to open the real app.
4. Press **Exit** (or `Esc`). You are back on the calculator.
5. Repeat with the duress PIN `1357`. The app opens the same way, and the backend log shows `SOS queued ... trigger=duress`.
6. Repeat with a wrong PIN. The calculator just shows `0000` as the result and stays a calculator. Five wrong PINs lock unlocking for 60 seconds.

Keyboard works too: digits, `+ - * /`, `Enter` for `=`, `Backspace`. Tapping the display deletes one digit.

## Tests

```bash
cd backend  && pytest -q        # auth, duress SOS, lockout, health
cd frontend && npm test         # calculator engine
```

## API (Phase A)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{status, db}` |
| POST | `/api/auth/setup` | `{real_pin, duress_pin}` → `{account_id}`. PINs are 4–8 digits and must differ. |
| POST | `/api/auth/unlock` | `{account_id, pin}` → `{token, expires_in}`. The duress PIN returns the same shape and silently records an SOS. Any failure returns `401 {"detail":"invalid"}`. |
| GET | `/api/me` | Bearer token |

PINs are hashed with scrypt. Both hashes are always checked so response timing does not reveal which PIN matched. The JWT carries an opaque scope (`a`/`b`), never the word "duress".

## Project layout

```
backend/   FastAPI + SQLAlchemy (SQLite locally, Postgres in Docker)
  app/routers/    health, auth
  app/services/   sos (dispatch adapters arrive in Phase B)
frontend/  React + Vite + TS PWA (manifest name "Calculator")
  src/calculator/ eval-free calculator engine + hidden unlock
  src/screens/    Setup, Home
```

## Roadmap

- [x] **A**: scaffold, health, real/duress PIN auth, decoy calculator with secret unlock
- [ ] **B**: trusted contacts, SOS engine with notification adapters (mock/SMS/email), GPS, received-alerts dashboard
- [ ] **C**: live location share with expiring link, breadcrumb map, "I'm safe"
- [ ] **D**: client-side encrypted evidence vault, hash chain, export
- [ ] **E**: geofencing, offline queue, panic wipe, PWA install polish
