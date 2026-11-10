import { enqueue, flushQueue } from '../offline/queue'
import type { WatchZone } from '../types/api'
import { STREAM_INTERVAL_MS } from '../utils/config'
import { getWatch, setWatch, type WatchData } from '../utils/storage'
import { readLocationSilently } from './device'
import { newZoneState, stepZone, type Fix, type ZoneState } from './geofence'

const TRAIL_LENGTH = 20

let timer: ReturnType<typeof setInterval> | undefined
// Recent positions stay in memory only: a location history on the phone could be found.
let trail: Fix[] = []

/** One check of every watched zone against a position. Queues an alert for each crossing that should raise one. */
export async function checkZones(fix: Fix, now = Date.now()): Promise<number> {
  const watch = getWatch()
  if (!watch) return 0

  const states: Record<string, ZoneState> = { ...watch.states }
  let fired = 0
  for (const zone of watch.zones) {
    const step = stepZone(zone, states[zone.i] ?? newZoneState(), fix, now)
    states[zone.i] = step.state
    if (step.fire) {
      fired++
      // Goes through the queue even when online, so it is sent once whatever the connection does.
      await enqueue({
        type: 'sos',
        token: watch.token,
        payload: {
          trigger: 'geofence',
          zone_event: step.fire,
          zone_kind: zone.k === 'd' ? 'danger' : 'safe',
          location: fix,
          trail: trail.slice(-TRAIL_LENGTH),
        },
      })
    }
  }
  setWatch({ ...watch, states })
  trail.push(fix)
  if (trail.length > TRAIL_LENGTH) trail = trail.slice(-TRAIL_LENGTH)
  return fired
}

async function tick() {
  const fix = await readLocationSilently()
  if (!fix) return
  if (await checkZones(fix)) void flushQueue({ force: true })
}

/**
 * Runs on the calculator with no session. Silent: it never touches the screen and never prompts.
 * Only while the app is open and the phone is awake: a web app cannot watch zones in the background.
 */
export function startWatcher() {
  stopWatcher()
  if (!getWatch()?.zones.length) return
  void tick().catch(() => undefined)
  timer = setInterval(() => void tick().catch(() => undefined), STREAM_INTERVAL_MS)
}

export function stopWatcher() {
  clearInterval(timer)
  timer = undefined
  trail = []
}

/** Saves what the server said to watch. Keeps crossing state so a list refresh can't re-arm a zone. */
export function updateWatch(zones: WatchZone[], token: string | null) {
  const previous = getWatch()?.states ?? {}
  const states = Object.fromEntries(zones.filter((z) => previous[z.i]).map((z) => [z.i, previous[z.i]]))
  const data: WatchData | undefined = zones.length && token ? { zones, token, states } : undefined
  setWatch(data)
  startWatcher()
}
