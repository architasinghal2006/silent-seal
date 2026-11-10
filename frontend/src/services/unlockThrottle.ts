// Five wrong PINs in a row pause unlocking on this phone for a minute.
//
// The server enforces the same rule for online unlocks. This copy matters offline, where a
// wrong PIN never reaches the server. It is held in memory, so reloading the page clears it:
// it slows someone tapping through guesses, and the server's lockout is the one that holds.
//
// While paused, an attempt is refused before anything is checked, and the calculator simply
// shows the number that was typed. Nothing on screen says a lockout is in effect.

export const MAX_FAILURES = 5
export const LOCKOUT_MS = 60_000

let failures = 0
let lockedUntil = 0

export function unlockAllowed(now = Date.now()): boolean {
  return now >= lockedUntil
}

export function recordFailure(now = Date.now()) {
  failures += 1
  if (failures >= MAX_FAILURES) {
    failures = 0
    lockedUntil = now + LOCKOUT_MS
  }
}

export function recordSuccess() {
  failures = 0
  lockedUntil = 0
}

export function resetThrottle() {
  failures = 0
  lockedUntil = 0
}
