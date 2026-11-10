import { useCallback, useEffect, useState } from 'react'
import { locationPermission, requestLocationPermission, type LocationPermission } from '../geolocation/device'
import type { Location } from '../types/api'

const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 }

/**
 * The phone's own position, for drawing on a map on this screen. It stays on the phone.
 *
 * It follows the position only while this screen is open and only if location is already
 * allowed. It never prompts by itself: `request` must be called from the survivor's own tap.
 * A web app gets no location once it is closed or the phone is locked.
 */
export function useGeolocation() {
  const [permission, setPermission] = useState<LocationPermission>('prompt')
  const [position, setPosition] = useState<Location | null>(null)

  useEffect(() => {
    let current = true
    void locationPermission().then((state) => {
      if (current) setPermission(state)
    })
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    if (permission !== 'granted' || !('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => undefined,
      WATCH_OPTIONS,
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [permission])

  const request = useCallback(async () => {
    const state = await requestLocationPermission()
    setPermission(state)
    return state
  }, [])

  return { permission, position, request }
}
