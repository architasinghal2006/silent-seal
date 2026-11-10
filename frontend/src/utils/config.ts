/**
 * The sequence that opens hidden unlock mode on a phone that has not chosen its own yet:
 * a fresh install, or one just wiped. Typed on the calculator, followed by "=".
 */
export const DEFAULT_SEQUENCE: string = (import.meta.env.VITE_UNLOCK_SEQUENCE as string | undefined) || '1379'

/** Hidden PIN mode silently reverts to a plain calculator after this long. */
export const PIN_MODE_TIMEOUT_MS = 30_000

/** How often the location is sent while a share is active, and zones are checked. */
export const STREAM_INTERVAL_MS = 15_000

/** The real app locks itself back to the calculator after this much inactivity. */
export const IDLE_LOCK_MS = 5 * 60_000

/** How long the SOS and panic-wipe controls must be held before they act. */
export const HOLD_MS = 2000

export const PIN_PATTERN = /^\d{4,8}$/
export const SEQUENCE_PATTERN = /^\d{4,8}$/
