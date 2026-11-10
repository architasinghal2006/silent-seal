import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordFailure, recordSuccess, resetThrottle, unlockAllowed, LOCKOUT_MS, MAX_FAILURES } from '../services/unlockThrottle'
import type { WatchZone } from '../types/api'
import { alertsOn, newZoneState, stepZone, type Fix } from './geofence'

const memory = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
})

const enqueue = vi.fn(async () => 'id')
vi.mock('../offline/queue', () => ({ enqueue: (...args: unknown[]) => enqueue(...(args as [])), flushQueue: vi.fn() }))

const { checkZones, stopWatcher } = await import('./watcher')
const { setWatch, getWatch } = await import('../utils/storage')

const LAT = 28.6139
const LNG = 77.209
const at = (metres: number): Fix => ({ lat: LAT + metres / 111_195, lng: LNG, accuracy: 10 })
const zone = (flags: Partial<WatchZone>): WatchZone => ({ i: 'z1', a: LAT, o: LNG, r: 200, k: 's', ...flags })

/** Feeds positions through one zone and returns what fired. */
function crossings(z: WatchZone, distances: number[]) {
  let state = newZoneState()
  const fired: string[] = []
  distances.forEach((d, i) => {
    const step = stepZone(z, state, at(d), 1_000_000 + i * 15_000)
    state = step.state
    if (step.fire) fired.push(step.fire)
  })
  return fired
}

beforeEach(() => {
  memory.clear()
  enqueue.mockClear()
  stopWatcher()
  resetThrottle()
})

describe('zone alert preferences', () => {
  const LEAVE = [0, 0, 500, 500]
  const ENTER = [500, 500, 0, 0]

  it('follow the zone type when a saved watch list has no preferences', () => {
    expect(alertsOn(zone({ k: 'd' }))).toEqual({ enter: true, exit: false })
    expect(alertsOn(zone({ k: 's' }))).toEqual({ enter: false, exit: true })
  })

  it('a safe zone can alert on arrival as well as on leaving', () => {
    expect(crossings(zone({ k: 's', e: true, x: true }), ENTER)).toEqual(['entered'])
    expect(crossings(zone({ k: 's', e: true, x: true }), LEAVE)).toEqual(['left'])
  })

  it('a danger zone can alert on leaving instead of entering', () => {
    expect(crossings(zone({ k: 'd', e: false, x: true }), ENTER)).toEqual([])
    expect(crossings(zone({ k: 'd', e: false, x: true }), LEAVE)).toEqual(['left'])
  })

  it('a zone with both turned off never alerts', () => {
    expect(crossings(zone({ e: false, x: false }), [...LEAVE, 0, 0])).toEqual([])
  })
})

describe('the watcher', () => {
  it('queues one alert with the zone type and recent trail when a crossing is confirmed', async () => {
    setWatch({ zones: [zone({ k: 'd', e: true, x: false })], token: 'watch-token', states: {} })

    for (const distance of [500, 500, 0]) expect(await checkZones(at(distance))).toBe(0)
    expect(await checkZones(at(0))).toBe(1)

    expect(enqueue).toHaveBeenCalledOnce()
    const queued = (enqueue.mock.calls[0] as unknown as [{ type: string; token: string; payload: Record<string, any> }])[0]
    expect(queued.type).toBe('sos')
    expect(queued.token).toBe('watch-token')
    expect(queued.payload).toMatchObject({ trigger: 'geofence', zone_event: 'entered', zone_kind: 'danger' })
    expect(queued.payload.trail).toHaveLength(3)
    // Crossing state is remembered, so the next check can't fire the same alert again.
    expect(getWatch()!.states.z1.inside).toBe(true)
    expect(await checkZones(at(0))).toBe(0)
  })

  it('does nothing when no zones are being watched', async () => {
    expect(await checkZones(at(0))).toBe(0)
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('unlock lockout', () => {
  it('pauses after five failures in a row and lifts after a minute', () => {
    const now = 1_000_000
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(now)
    expect(unlockAllowed(now)).toBe(true)
    recordFailure(now)
    expect(unlockAllowed(now + 1)).toBe(false)
    expect(unlockAllowed(now + LOCKOUT_MS - 1)).toBe(false)
    expect(unlockAllowed(now + LOCKOUT_MS)).toBe(true)
  })

  it('a correct PIN resets the count', () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure()
    recordSuccess()
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure()
    expect(unlockAllowed()).toBe(true)
  })
})
