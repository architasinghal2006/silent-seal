import { STREAM_INTERVAL_MS } from '../config'
import { readLocationSilently } from './device'
import { newZoneState, stepZone, type Fix, type WatchZone, type ZoneState } from './geofence'
import { enqueue, flushQueue, newClientId } from './queue'
import { getWatch, setWatch, type WatchData } from './storage'

const TRAIL_LENGTH = 20

let timer: ReturnType<typeof setInterval> | undefined
// Recent positions stay in memory only: a location history on the phone could be found.
let trail: Fix[] = []

async function tick() {
  const fix = await readLocationSilently()
  const watch = getWatch()
  if (!fix || !watch) return

  const states: Record<string, ZoneState> = { ...watch.states }
  let fired = false
  for (const zone of watch.zones) {
    const step = stepZone(zone, states[zone.i] ?? newZoneState(), fix, Date.now())
    states[zone.i] = step.state
    if (step.fire) {
      fired = true
      await enqueue({
        path: '/offline/sos',
        token: watch.token,
        body: {
          client_id: newClientId(),
          trigger: 'geofence',
          zone_event: step.fire,
          client_ts: new Date().toISOString(),
          location: fix,
          trail: trail.slice(-TRAIL_LENGTH),
        },
      })
    }
  }
  setWatch({ ...watch, states })
  trail.push(fix)
  if (trail.length > TRAIL_LENGTH) trail = trail.slice(-TRAIL_LENGTH)
  if (fired) void flushQueue()
}

/** Runs on the calculator with no session. Silent: it never touches the screen and never prompts. */
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
