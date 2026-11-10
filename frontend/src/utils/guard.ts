// The app locks itself when the page is hidden, but opening the camera or file picker hides
// the page too. This lets that one action through, and always expires on its own so the
// lock can never be left switched off.
const MAX_PAUSE_MS = 2 * 60_000

let pausedUntil = 0

export function pauseHideLock() {
  pausedUntil = Date.now() + MAX_PAUSE_MS
}

export function resumeHideLock() {
  pausedUntil = 0
}

export function hideLockPaused() {
  return Date.now() < pausedUntil
}
