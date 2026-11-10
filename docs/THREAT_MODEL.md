# Threat model

Silent Seal is designed around one situation: **the survivor lives with the person threatening them, and that person may pick up, inspect or force the unlocking of the phone.** This document says what the prototype defends against, what it doesn't, and where a web app runs out.

It makes no claim to be undetectable or forensically invisible, and it cannot guarantee anyone's physical safety.

## Who we are defending against

| Adversary | Can | Assumed not to |
|---|---|---|
| **Abuser with the phone** (primary) | Open apps, read screens, watch over a shoulder, demand a PIN, tap anything | Use forensic tools, read browser storage, or analyse network traffic |
| **Technically capable abuser** | All of the above, plus inspect browser storage, history and installed apps | Break standard cryptography |
| **Someone with a share link** | Open the link | Guess another one |
| **Network observer** | See which servers the phone talks to and when | Read HTTPS traffic |
| **Whoever compromises the server** | Read and alter the database | Know the vault passphrase |

## Threats and responses

### 1. Coercive access to the phone

*"Unlock it. Show me."*

- The **duress PIN** opens a working, empty-looking copy of the app and silently alerts the real contacts.
- Server responses for the two PINs have the same status, fields and token size. The token's scope is an opaque letter. Both hashes are checked every time, so timing doesn't differ.
- The phone itself cannot tell which PIN it was given, so it behaves identically: there is no client-side "duress mode" to find.
- In the decoy, "I'm safe", delete-account and location controls act only on decoy data. The real alert, share and evidence can't be cancelled or destroyed by a forced action.

**Not defended:** an abuser who knows the app has two PINs can demand both. An empty app may itself raise suspicion. The decoy has no fake history to make it look used.

### 2. Accidental disclosure

- Installs as "Calculator" with a calculator icon, and opens as one.
- No notifications, sounds or vibration, ever.
- A wrong PIN shows as an ordinary result. There is no error and no PIN screen.
- After an alert the app returns to the calculator and shows nothing (the status screen is opt-in).
- Alerts tell contacts not to call or text back.

**Not defended:** a contact who replies anyway. A browser that offers to save or autofill a field. The microphone indicator the phone shows while recording.

### 3. Device inspection

- Navigation is in memory: the address bar and history show only the site address.
- Session token, vault keys and decrypted evidence exist only in memory, and are dropped on Exit, `Esc`, switching apps, 5 idle minutes, reload or close.
- Local storage sits under a key that reads as calculator preferences, with short field names.
- The secret sequence is stored as a salted hash.

**Not defended:** the site's address is in browser history and the installed-apps list. Inspecting storage shows that *something* beyond a calculator is stored (an id, sealed records, zone coordinates). The app switcher may show a snapshot of the last screen: the app is only told it was hidden after the fact. Screenshots can't be blocked. A short numeric sequence or PIN can be brute-forced by someone who copies the storage; a longer PIN helps.

### 4. Unauthorized access by a contact or a stranger

- Share links carry a 128-bit random id plus a 128-bit HMAC. The token is derived, not stored, so a database leak alone doesn't yield live links.
- Validity is checked on the server for every request. A link shows one share's trail, only while it is live, and nothing after it ends or expires.
- Share pages are `no-store`, `noindex`, and can't be framed.
- Only contacts marked as emergency contacts are told anything.
- Guessing is rate limited.

**Not defended:** a contact who forwards the link. Anyone holding a live link sees the location until it ends.

### 5. Compromised network

- HTTPS is required in production (and by browsers, for location and service workers). HSTS is sent on HTTPS.
- A strict content policy allows scripts and connections only from the app's own origin.
- Evidence is encrypted before it is sent, so even a broken transport exposes only ciphertext.

**Not defended:** an observer still sees that the phone contacts this server, and when. Map tiles come from OpenStreetMap, which therefore sees which area is being viewed. A network-level block stops alerts until a connection returns.

### 6. Evidence tampering

- Each entry carries the hash of the one before it. Editing, reordering or removing a middle entry breaks the chain.
- The chain position is authenticated inside the encryption, so recomputing every hash still fails at decryption.
- The server refuses any entry that doesn't extend the head, and has no edit or delete endpoint for entries.
- Exports can be verified by anyone with `tools/verify_bundle.py`, with no access to the app or server.

**Not defended:** removal of the *newest* entries can't be detected, because nothing later links to them. Times and locations inside entries come from the device and are not independent proof; only the server's arrival time was recorded by another party. **This is integrity checking, not proof that an event happened**, and it is not a certified forensic process. Whether a court accepts it is a legal question.

### 7. Offline data exposure

- Offline unlock uses two PIN-sealed records of identical size in random order, each holding an opaque token.
- Evidence created offline is sealed to a public key before it is queued. Plaintext evidence is never written to storage.
- Tokens kept for offline use can only send queued events or zone alerts. They can't read anything.

**Not defended:** queued alerts are stored unencrypted until sent (type, time, location). The watched-zone list (coordinates, not names) is stored in the clear so zones can be checked with no session. Someone who copies storage could brute-force a short PIN offline.

### 8. Server compromise

- PINs are stored only as salted scrypt hashes.
- Evidence is ciphertext. The passphrase and key never leave the phone, so the server can't read it and the operator can't be compelled to.
- Share-link tokens can't be derived from the database without the server secret.
- Logs record ids and counts, never message text, locations or which PIN was used.

**Not defended:** contacts, zones and location trails are stored in the clear, because the server needs them to send alerts and draw maps. The database shows which unlocks were duress (the alert's trigger). A PIN is 4 to 8 digits, so its hash can be brute-forced by someone who steals the database. An attacker with the server secret can forge session tokens.

## Panic wipe: what it is and isn't

A 2-second hold clears the app's local storage and the offline queue and returns to a fresh calculator.

It is **not** secure erasure. A web app can't overwrite storage, reach device backups, clear browser history, or delete files already exported to Downloads. Nothing on the server is deleted: evidence stays there and returns with the recovery code and PIN. Alerts still waiting to send are lost, and a live share stops updating.

## Limits of a web app

| Limit | Consequence | Needs |
|---|---|---|
| No background execution | Location sharing, zone checks and queued sending stop when the app is closed or the phone locks | Native background location and geofencing |
| Told about being hidden only afterwards | The app switcher may show the last screen | Native secure-window flag |
| Can't block screenshots or screen recording | Anything on screen can be captured | Native secure-window flag |
| Can't hide from the installed-apps list or history | The app's presence can be discovered | A native app with a plausible second purpose |
| Browser storage can be cleared by the browser | Offline data may vanish under storage pressure | Native storage |
| Battery level unavailable on some browsers | Alerts go without it | Native API |

## Prototype shortcuts to fix before real use

- SMS and email delivery are stubs. Nothing is actually delivered.
- Rate limiting and the logout list are in one process's memory or one table, sized for a single small server.
- No independent security review, penetration test, or review by a domestic-violence service has been done. Both would be essential before any real deployment.
