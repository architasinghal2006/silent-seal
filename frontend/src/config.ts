/** Expression typed on the calculator, followed by "=", that opens hidden unlock mode. */
export const UNLOCK_SEQUENCE: string = (import.meta.env.VITE_UNLOCK_SEQUENCE as string | undefined) || '1379'

/** Hidden PIN mode silently reverts to a plain calculator after this long. */
export const PIN_MODE_TIMEOUT_MS = 30_000

/** How often the location is sent while a share is active. */
export const STREAM_INTERVAL_MS = 15_000

/** The real app locks itself back to the calculator after this much inactivity. */
export const IDLE_LOCK_MS = 5 * 60_000
