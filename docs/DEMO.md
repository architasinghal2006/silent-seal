# Demonstration walkthrough

Six scenarios, about ten minutes in all. Every step below was run end to end in a browser against this build.

## Before you start

1. In `.env`, set `JWT_SECRET` and `DEMO_DASHBOARD_TOKEN` (any value, for example `judge`).
2. Start the backend: `cd backend && uvicorn app.main:app --port 8000`.
3. Build and serve the app: `cd frontend && npm run build && npm run preview`, then open **http://localhost:4173** in Chrome or Edge. The built app is needed for the offline scenario.
4. In a second window, open **http://localhost:8000/api/demo/dashboard** and enter the demo token. Keep it beside the app.
5. For moving a location by hand: Chrome DevTools > **⋮ > More tools > Sensors > Location**.

**First-time setup** (once): on the calculator type `1379` then `=`. Follow the screens. This walkthrough assumes secret sequence `2580`, PIN `2468`, duress PIN `1357`, one trusted contact, a vault passphrase, and location allowed.

On a demo server, **Settings > Load sample data** fills the account with sample contacts, zones and past alerts, each marked "Sample".

## 1. Normal access

1. The app opens as a calculator. Try `12 + 3 × 4 =`: it shows `24`.
2. Type `2580` then `=`. A small **M** appears in the display. Nothing else changes.
3. Type `2468` then `=`. The safety dashboard opens.
4. Note the address bar: it still shows only the site address. Pressing **Exit** or `Esc` returns to the calculator.

**Shows:** the disguise, the secret sequence, and that a real unlock raises no alert (the dashboard feed is unchanged).

## 2. Duress access

1. On the calculator: `2580 =`, then the duress PIN `1357 =`.
2. The same app opens, but empty: no contacts, no history, and no sign that anything was sent.
3. Look at the judge dashboard. A **Duress PIN** alert has appeared, addressed to the real contact, with location, battery and an active live share.
4. In the dashboard's **Authentication demonstration**, press **Create demo account**, then **Unlock with both PINs**. The table shows the two responses side by side: same status, same fields, same token length, no mention of duress.
5. In the decoy, open **Location**. It says "Not sharing". Starting or stopping a share here touches only a decoy share: the real one keeps running.
6. Try a wrong PIN: the calculator just shows the number. After five wrong tries, unlocking pauses for 60 seconds and the calculator keeps working.

**Shows:** the two PINs are indistinguishable from the phone, and a forced unlock cannot see or cancel the real response.

## 3. Live location

1. Unlock with the real PIN. Home shows "Your location is being shared" (from scenario 2). Open **Location**.
2. The map shows your position, the trail, how long sharing has run, when the link ends and who can see it.
3. On the dashboard, open the alert's **Open contact map** link. This is what the contact sees. Change the position in DevTools Sensors: within 15 seconds the trail extends.
4. Change the last few characters of that link: it shows "This link is not valid" and no location.
5. In the app, press **I'm safe** and confirm. The contact's page changes to "They marked themselves safe" and shows no location. The dashboard shows the follow-up notification.
6. For a trail without moving: press **Simulate incoming SOS** on the dashboard and open its contact map. The trail advances every few seconds. It is labelled **Simulated** throughout.

Links expire after `LIVE_SHARE_TTL_MINUTES` (120 by default). To see expiry quickly, start the backend with `LIVE_SHARE_TTL_MINUTES=1`.

**Shows:** unguessable expiring links, server-side validation, and that nothing is visible once a share ends.

## 4. Evidence preservation

1. Open **Vault** and enter the passphrase. Add a note, then a photo or a recording.
2. Each card shows its type, time and a short encrypted-entry id. The banner reads "Integrity check passed".
3. Press **Verify hash chain**. The server checks the chain and says what the check does and doesn't prove.
4. Press **Export encrypted copy**. Open the downloaded file in a text editor: it holds only ciphertext and hashes.
5. Verify it with no app and no server:

   ```bash
   cd backend
   python tools/verify_bundle.py path/to/calc-history-DATE.json
   python tools/verify_bundle.py path/to/calc-history-DATE.json --ask     # also decrypts
   ```

6. Change one character inside any `"ciphertext"` in the file and run the tool again. It reports `[modified] entry N` and exits with code 1.
7. Or do the same on the dashboard: under **Evidence verification**, choose the file and press **Alter one entry, then verify**.

**Shows:** client-side encryption, ciphertext-only storage, the hash chain, and tamper detection.

## 5. Offline mode

1. In DevTools > **Network**, set **Offline**. Reload: the calculator still loads and works.
2. Unlock with the real PIN. Home says "You're offline".
3. Hold the SOS button for 2 seconds. In **Vault**, add a note: it says the note is encrypted and waiting on this phone.
4. On a demo server, **Settings > Sync status** lists the queued items. The dashboard shows nothing new yet.
5. Turn **Offline** off. Within a few seconds the dashboard shows the alert once, marked as delayed, and **Offline queue** lists the events received.
6. Unlock and open the vault: the offline note has joined the chain.

To see duplicate prevention directly, the backend test `test_a_retried_event_takes_effect_once_and_is_counted` sends the same event three times: one alert, two duplicates counted.

**Shows:** offline unlock, offline SOS and evidence, the persistent queue, and exactly-once delivery.

## 6. Panic wipe

1. Unlock, open **Settings**, and note the recovery code.
2. Hold **Hold to wipe this phone** for 2 seconds. A tap does nothing.
3. The app is a fresh calculator. `2580 =` no longer does anything. `1379 =` opens first-time setup.
4. Choose **I have a recovery code** and enter the code with the PIN: the evidence is still there, because a wipe never deletes anything from the server.

**Shows:** fast local clearing, and that evidence survives it.

## What the badges mean

- **Operational** on the dashboard: that part runs for real in this build.
- **Simulated** or **Sample**: it stands in for something outside this build. Notifications are the main case: the mock adapter records each message and sends nothing, and the app says "Simulated: recorded, not sent" rather than "Sent".
