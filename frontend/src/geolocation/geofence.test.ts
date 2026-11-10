import { describe, expect, it } from 'vitest'
import { COOLDOWN_MS, distanceMetres, hysteresisMargin, newZoneState, stepZone, type Fix, type WatchZone, type ZoneState } from './geofence'

const LAT = 28.6139
const LNG = 77.209
const METRES_PER_DEGREE = 111_195

const zone = (k: 'd' | 's', r = 200, flags: Partial<WatchZone> = {}): WatchZone => ({ i: 'z', a: LAT, o: LNG, r, k, ...flags })
const at = (metres: number, accuracy: number | null = 10): Fix => ({ lat: LAT + metres / METRES_PER_DEGREE, lng: LNG, accuracy })

function run(z: WatchZone, distances: number[], start: ZoneState = newZoneState(), startAt = 1_000_000) {
  const fires: string[] = []
  let state = start
  distances.forEach((d, n) => {
    const step = stepZone(z, state, at(d), startAt + n * 15_000)
    state = step.state
    if (step.fire) fires.push(step.fire)
  })
  return { state, fires }
}

describe('distanceMetres', () => {
  it('measures a known distance', () => {
    expect(distanceMetres(LAT, LNG, LAT + 1000 / METRES_PER_DEGREE, LNG)).toBeCloseTo(1000, 0)
  })
})

describe('danger zone', () => {
  it('fires on entering, once it holds', () => {
    expect(run(zone('d'), [1000, 1000, 50]).fires).toEqual([])
    expect(run(zone('d'), [1000, 50, 50]).fires).toEqual(['entered'])
  })

  it("doesn't fire on leaving", () => {
    expect(run(zone('d'), [50, 1000, 1000, 1000]).fires).toEqual([])
  })

  it("doesn't fire when first seen already inside", () => {
    expect(run(zone('d'), [50, 50, 50]).fires).toEqual([])
  })
})

describe('safe zone', () => {
  it('fires on leaving, once it holds', () => {
    expect(run(zone('s'), [50, 1000, 1000]).fires).toEqual(['left'])
  })

  it("doesn't fire on entering", () => {
    expect(run(zone('s'), [1000, 50, 50, 50]).fires).toEqual([])
  })
})

describe('flapping at the edge', () => {
  const margin = hysteresisMargin(200)

  it('ignores readings inside the band, however many', () => {
    const edge = [200, 200 - margin + 1, 200 + margin - 1]
    expect(run(zone('d'), [1000, ...edge, ...edge, ...edge]).fires).toEqual([])
    expect(run(zone('s'), [50, ...edge, ...edge, ...edge]).fires).toEqual([])
  })

  it('ignores a single jump across the edge', () => {
    expect(run(zone('d'), [1000, 50, 1000, 50, 1000, 50, 1000]).fires).toEqual([])
  })

  it('requires consecutive readings: the band resets the count', () => {
    expect(run(zone('d'), [1000, 50, 200, 50]).fires).toEqual([])
  })

  it("won't fire twice within the cooldown", () => {
    const { fires } = run(zone('d'), [1000, 50, 50, 1000, 1000, 50, 50])
    expect(fires).toEqual(['entered'])
  })

  it('fires again after the cooldown', () => {
    const first = run(zone('d'), [1000, 50, 50])
    const out = run(zone('d'), [1000, 1000], first.state, 1_000_000 + 60_000)
    const back = run(zone('d'), [50, 50], out.state, 1_000_000 + COOLDOWN_MS + 60_000)
    expect(back.fires).toEqual(['entered'])
  })
})

describe('poor readings', () => {
  it('ignores a fix too inaccurate to trust', () => {
    const state: ZoneState = { ...newZoneState(), inside: false }
    const step = stepZone(zone('d'), state, at(50, 800), 1_000_000)
    expect(step.state).toEqual(state)
    expect(step.fire).toBeNull()
  })

  it('accepts a fix with unknown accuracy', () => {
    expect(stepZone(zone('d'), newZoneState(), at(50, null), 1).state.inside).toBe(true)
  })
})
