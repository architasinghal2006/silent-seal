# Silent Seal

A covert personal-safety PWA for domestic-abuse survivors who live with the perpetrator. It opens as a fully working **calculator**. A secret input sequence reveals the real app, where the survivor alone controls distress signals, location sharing and an encrypted evidence vault.

> This app complements, and does not replace, emergency services. In India: **112** emergency, **181** women's helpline, **1098** childline.

Hackathon working model. All data is dummy or demo data.

## Safety principles

- **Survivor-initiated only.** Nothing is shared unless the survivor acts, and only with contacts they add.
- **Plausible deniability.** The app installs as "Calculator" and works as one.
- **Duress PIN.** Opens an empty app *and* silently fires an SOS. The server response is identical to a real unlock.
- **Silent by default.** No sounds, toasts, vibration or notifications.
- **Encryption at rest.** Evidence is encrypted with AES-256-GCM in the browser, with the key derived from a passphrase separate from the PIN. The server stores only ciphertext.
- **Offline-first.** The app, both PINs, alerts and new evidence all work with no connection, and send when it returns.
- **Panic wipe.** Holding for 2 seconds clears the phone and leaves a working calculator. Evidence stays on the server unless the survivor separately deletes it.
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

If the database is reset, this browser still holds the old account and unlocking will fail. Clear the site data for `localhost:5173` and run setup again.

## Demo walkthrough (Phase B)

1. Set `DEMO_DASHBOARD_TOKEN` in `.env` and restart the backend. Open http://localhost:8000/api/demo/dashboard and enter that token. Keep this tab beside the app.
2. Unlock with the real PIN. Tap **Allow location** if it appears. Silent alerts can never show a permission prompt, so location has to be allowed here first.
3. Open **Trusted contacts**, enter your name in alerts and add a dummy contact or two.
4. Back on the home screen, tap the red button briefly. Nothing happens. Then **hold it for 2 seconds**. The app returns to the calculator with no message, and the dashboard shows the alert followed by a location update.
5. Unlock again. **Recent alerts** shows who was reached.
6. Unlock with the duress PIN. The app shows no contacts or history, while the dashboard shows a `DURESS` alert sent to the real contacts, with the location following.

Alerts are not really sent yet. The default `mock` adapter logs to the backend console and fills the dashboard. Setting `NOTIFY_ADAPTER=sms` or `email` selects a stub that checks its configuration and sends nothing; those attempts show as `stub` or `failed`, never `sent`.

## Demo walkthrough (Phase C)

1. Send an alert as in Phase B. In the dashboard, click the **Live map** link in the alert. This is what a contact sees.
2. Leave the app on the calculator. The location keeps updating every 15 seconds and the map draws a trail. To see it move in Chrome, change the position under DevTools > Sensors.
3. Reload the app. It stays on the calculator and sharing picks back up without a PIN.
4. Unlock with the duress PIN. The app shows no sign of sharing and has no "I'm safe" button, and the map stays live.
5. Unlock with the real PIN. A card says your contacts can see your location. Press **I'm safe** and confirm. The map stops showing any location, says they marked themselves safe, and contacts get a message.

The link ends after `LIVE_SHARE_TTL_MINUTES` (default 120) if nobody ends it first. Set `PUBLIC_BASE_URL` to an address contacts can reach, because links to `localhost` only work on this computer.

**Limit:** a web app can only send its location while it is open and the phone is awake. If the phone locks or the app is closed, updates pause, and the map warns the contact after 2 minutes without one. Sharing resumes when the app reopens.

## Demo walkthrough (Phase D)

1. Unlock with the real PIN and open **Evidence vault**. Create a passphrase, which must be separate from your PIN. It can't be recovered if forgotten.
2. Add a note, a photo and an audio recording. Each saves your location and the time, and the app shows `Integrity check passed`.
3. Press **Exit** while recording. The clip is still saved, and the vault is locked until you enter the passphrase again.
4. Tick **Also record 10 seconds of audio**, go back and hold the alert button. Open the vault again and the clip appears as **Audio from an alert**.
5. Press **Export encrypted copy**, then check it without the app:

   ```bash
   cd backend
   python tools/verify_bundle.py path/to/calc-history-DATE.json          # hash chain only
   python tools/verify_bundle.py path/to/calc-history-DATE.json --ask    # also decrypt
   ```

   Change one character inside any `ciphertext` in the file and run it again to see the check fail.
6. Unlock with the duress PIN and open the vault. It looks like one that was never set up. A passphrase forced here opens a separate, empty vault.

**How it works:** PBKDF2-SHA256 (600,000 rounds) turns the passphrase into an AES-256-GCM key that stays in memory and is dropped on lock. Type, text, media, time and location are all inside the ciphertext. Each entry's hash covers the previous hash, and its chain position is sealed into the encryption, so a server that recomputes every hash still fails when the entry is opened. SOS audio is sealed to an RSA public key, because the vault is usually locked during an alert, and joins the chain the next time it opens.

**Limits, which matter if this is ever used as evidence:**

- Removing the *newest* entries can't be detected, because nothing later links to them.
- Times and locations come from the device, so they are not independent proof. Only the server's `created_at` was recorded by another party.
- This shows the record is internally consistent. It is not a certified forensic process, and whether a court accepts it is a legal question.
- Entries are capped at 8 MB. The whole vault downloads each time it opens, so a large vault will be slow on a low-end phone.

## Demo walkthrough (Phase E)

**Install:** run `npm run build && npm run preview`, open http://localhost:4173 in Chrome, and choose **Install**. It appears as "Calculator" with a calculator icon. Service workers only run in the built app, so offline steps won't work under `npm run dev`.

**Offline:** in DevTools > Network, set **Offline** and reload.

1. The calculator still loads and works. A wrong PIN still just shows the number.
2. The real PIN opens the app with a "You're offline" card. Hold the alert button, and add a note in the vault.
3. Nothing reaches the dashboard yet. Turn **Offline** off. The alert arrives once, with the location from when it was sent, and the note joins the vault the next time it opens.
4. Repeat with the duress PIN. It looks the same on the phone, and when back online the dashboard shows a `DURESS` alert.

**Zones:** open **Safe & danger zones**. Tap the map or use your current location, then return to the calculator and change the position under DevTools > Sensors. A change has to hold for two checks, 15 seconds apart, so allow about 30 seconds. Standing near the edge fires nothing, because of the hysteresis margin.

**Panic wipe:** note your recovery code in **Safety settings**, then hold **Hold to wipe this phone**. The app is back to a fresh calculator, and `1379=` shows first-time setup. Choose **I have a recovery code** and enter it with your PIN to get your evidence back.

**Delete from server:** in **Safety settings**, confirm with your PIN. Everything for the account is removed and live map links stop working. Under the duress PIN this only clears the decoy side.

**Limits:**

- **Background:** like live location, zones and the queue only run while the app is open and the phone is awake. A web app can't watch zones or send a queued alert from the background. A native app would be needed for that.
- **Recovery after a wipe:** a restored phone only has offline unlock for PINs used on it since. Until the duress PIN has been used once online, it won't work offline there.
- **Short PINs:** someone who copies the phone's browser storage could guess a short PIN offline. Longer PINs help. That storage also shows that an account exists and which zones are watched, though not their names, and queued alerts are stored unencrypted until sent.
- **Panic wipe:** alerts still waiting to send are lost, and any live map stops updating, warning the contact after 2 minutes. Exported files in Downloads, browser history and server logs are outside what it can clear. The mock adapter writes alert text to the server log, so a real deployment must not log it.
- **Server data:** zones (name, location and size) and location trails are not encrypted on the server. Only evidence is. "I'm safe" keeps the trail, and only **Delete from server** removes it.

### How duress stays hidden

- The client cannot tell real from duress, so it behaves the same after every unlock, including sending its location. The server keeps that location only if an SOS is in progress, and discards it after a normal unlock. Its reply just says whether to keep streaming.
- A duress session sees empty lists and cannot read, edit or delete real contacts. Contacts added under duress are stored as decoys and never receive alerts.
- A duress session has its own empty vault. Audio clips sent from one are discarded, so they can never be played back by whoever forced the unlock.
- Offline, each PIN opens one of two identical-looking records holding an opaque token. The phone reports either the same way, and the server decides from the token whether that was a duress unlock.
- A forced **Delete from server** only clears the decoy side, so evidence can't be destroyed under duress.
- A duress session cannot see an active share, and "I'm safe" does nothing in one, so a forced unlock cannot cancel an SOS.
- Alerts tell contacts not to call or text back, and duress alerts warn that someone may be forcing the unlock.

## Tests

```bash
cd backend  && pytest -q        # auth, duress, lockout, contacts, SOS dispatch, adapters, dashboard, live share, offline, zones, erase
cd frontend && npm test         # calculator engine, vault crypto, hash chain, geofence, offline PINs
```

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{status, db}` |
| POST | `/api/auth/setup` | `{real_pin, duress_pin}` → `{account_id}`. PINs are 4–8 digits and must differ. |
| POST | `/api/auth/unlock` | `{account_id, pin}` → `{token, expires_in}`. The duress PIN returns the same shape and silently records an SOS. Any failure returns `401 {"detail":"invalid"}`. |
| GET | `/api/me` | Bearer token |
| GET, POST | `/api/contacts` | Trusted contacts: name, phone or email, channel (`sms`/`email`) |
| PUT, DELETE | `/api/contacts/{id}` | A duress session gets `404` for real contacts |
| GET, PUT | `/api/profile` | `{alert_name}`, the name contacts see |
| POST | `/api/sos` | `{client_ts, battery, location}` → `202`. Alerts all real contacts. |
| POST | `/api/sos/context` | `{location, battery}` → `{stream, stream_token}`. Stored only during an SOS, otherwise discarded. |
| POST | `/api/live/point` | `{location}` → `{stream}`. Needs a stream token, which can do nothing else. |
| GET | `/api/live/status` | Whether a share is active. Always inactive for a duress session. |
| POST | `/api/live/safe` | "I'm safe": ends the share and tells contacts. Does nothing under duress. |
| GET | `/api/share/{token}`, `/api/share/{token}/data` | The contact's private map. After a share ends, the data only says how it ended. |
| GET | `/api/sos/history` | Last 10 alerts and outcomes. Always empty for a duress session. |
| GET, PUT | `/api/vault/meta` | Salt, KDF settings and sealed keys. Each session sees only its own side. |
| GET | `/api/vault/head`, `/api/vault/entries` | Chain head and ciphertext entries |
| POST | `/api/vault/entries` | Append only. Must link to the head and match its hash. |
| GET, POST, DELETE | `/api/vault/clips` | SOS audio waiting to join the chain. Discarded under duress. |
| GET, POST | `/api/zones` | The session's own zones, plus an opaque list of real zones for the device's watcher |
| DELETE | `/api/zones/{id}` | A duress session gets `404` for real zones |
| POST | `/api/offline/sos`, `/unlocked`, `/clip` | Queued work, using an offline token. Safe to retry. |
| GET | `/api/offline/token` | For a phone restored with a recovery code |
| POST | `/api/account/erase` | `{pin}`. Deletes everything, or only the decoy side under duress. |
| GET | `/api/demo/dashboard`, `/api/demo/alerts` | Demo only. `404` unless `DEMO_DASHBOARD_TOKEN` is set. |

PINs are hashed with scrypt. Both hashes are always checked so response timing does not reveal which PIN matched. The JWT carries an opaque scope (`a`/`b`), never the word "duress".

## Project layout

```
backend/   FastAPI + SQLAlchemy (SQLite locally, Postgres in Docker)
  app/routers/       health, auth, contacts, sos, live, vault, zones, offline, demo
  app/services/      sos capture and dispatch, live shares, erase
  app/notifications/ mock adapter, SMS and SMTP stubs
  app/share_map.html contact's map, served by the API so the calculator bundle never mentions it
  app/static/        vendored Leaflet 1.9.4
  tools/             verify_bundle.py, checks an export without the app
frontend/  React + Vite + TS PWA (manifest name "Calculator")
  src/calculator/ eval-free calculator engine + hidden unlock
  src/screens/    Setup, Home, Contacts, Vault, Zones, Safety
  src/lib/        api, device capture (GPS, battery), sos, location stream, crypto, vault, recorder,
                  geofence and watcher, offline queue, offline PIN records, wipe
```

## Roadmap

- [x] **A**: scaffold, health, real/duress PIN auth, decoy calculator with secret unlock
- [x] **B**: trusted contacts, SOS engine with notification adapters (mock, SMS and email stubs), GPS and battery capture, received-alerts dashboard. SOS audio moves to Phase D, where it can be encrypted.
- [x] **C**: live location share with expiring link, breadcrumb map, "I'm safe"
- [x] **D**: client-side encrypted evidence vault, hash chain, export, SOS audio
- [x] **E**: geofencing, offline queue, panic wipe, PWA install polish
