import type { Location } from './api'

export type LocationPermission = 'granted' | 'prompt' | 'denied' | 'unsupported'

const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }

export async function locationPermission(): Promise<LocationPermission> {
  if (!('geolocation' in navigator)) return 'unsupported'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state
  } catch {
    return 'prompt'
  }
}

function readPosition(): Promise<Location | null> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      GPS_OPTIONS,
    )
  })
}

/**
 * Reads GPS only if already allowed. A permission prompt during an SOS or a forced unlock
 * would be visible to whoever is watching, so this must never trigger one.
 */
export async function readLocationSilently(): Promise<Location | null> {
  return (await locationPermission()) === 'granted' ? readPosition() : null
}

/** Shows the browser's permission prompt. Only call from the survivor's own tap. */
export async function requestLocationPermission(): Promise<LocationPermission> {
  if (!('geolocation' in navigator)) return 'unsupported'
  await readPosition()
  return locationPermission()
}

interface BatteryManagerLike {
  level: number
}

/** Level from 0 to 1, or null where the browser has no Battery API (Safari, Firefox). */
export async function readBattery(): Promise<number | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }
  try {
    return nav.getBattery ? (await nav.getBattery()).level : null
  } catch {
    return null
  }
}
