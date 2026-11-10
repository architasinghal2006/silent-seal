// Decides when a position crosses a zone. Pure, so the flapping rules can be tested directly.

import type { WatchZone } from '../types/api'

export type { WatchZone }

/** Which crossings raise an alert. A watch list saved before preferences existed follows the zone type. */
export function alertsOn(zone: WatchZone): { enter: boolean; exit: boolean } {
  return { enter: zone.e ?? zone.k === 'd', exit: zone.x ?? zone.k === 's' }
}

export interface Fix {
  lat: number
  lng: number
  accuracy: number | null
}

export interface ZoneState {
  inside: boolean | null // null until there's a clear first reading
  pendingInside: boolean | null
  pendingCount: number
  lastFiredAt: number
}

export const newZoneState = (): ZoneState => ({ inside: null, pendingInside: null, pendingCount: 0, lastFiredAt: 0 })

const CONFIRMATIONS = 2
export const COOLDOWN_MS = 10 * 60_000

export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

/** Half-width of the band around the edge where a reading counts for neither side. */
export function hysteresisMargin(radius: number) {
  return Math.max(25, radius * 0.15)
}

export interface Step {
  state: ZoneState
  fire: 'entered' | 'left' | null
}

/**
 * Hysteresis: only a reading clearly inside or outside the band counts, and a change must hold
 * for consecutive readings. The first reading just records where the person is, so standing in
 * a zone while creating it doesn't raise an alarm. A cooldown is the last guard against repeats.
 */
export function stepZone(zone: WatchZone, state: ZoneState, fix: Fix, now: number): Step {
  if (fix.accuracy !== null && fix.accuracy > Math.max(150, zone.r)) return { state, fire: null }

  const distance = distanceMetres(fix.lat, fix.lng, zone.a, zone.o)
  const margin = hysteresisMargin(zone.r)
  const reading = distance <= zone.r - margin ? true : distance >= zone.r + margin ? false : null

  if (reading === null) return { state: { ...state, pendingInside: null, pendingCount: 0 }, fire: null }
  if (state.inside === null) return { state: { ...state, inside: reading, pendingInside: null, pendingCount: 0 }, fire: null }
  if (reading === state.inside) return { state: { ...state, pendingInside: null, pendingCount: 0 }, fire: null }

  const pendingCount = state.pendingInside === reading ? state.pendingCount + 1 : 1
  if (pendingCount < CONFIRMATIONS) return { state: { ...state, pendingInside: reading, pendingCount }, fire: null }

  const crossed: ZoneState = { ...state, inside: reading, pendingInside: null, pendingCount: 0 }
  const alerts = alertsOn(zone)
  const alarming = reading ? alerts.enter : alerts.exit
  if (!alarming || now - state.lastFiredAt < COOLDOWN_MS) return { state: crossed, fire: null }
  return { state: { ...crossed, lastFiredAt: now }, fire: reading ? 'entered' : 'left' }
}
