import type { Circle, CircleMarker, LayerGroup, LeafletMouseEvent, Map as LeafletMap, Polyline } from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import type { ZoneKind } from '../types/api'
import { cx } from '../utils/format'

const INDIA: [number, number] = [20.6, 78.9]
const ZONE_COLOR: Record<ZoneKind, string> = { danger: '#e5485b', safe: '#28b878' }
const TRAIL_COLOR = '#28b878'
const HERE_COLOR = '#f26aa5'

export interface MapZone {
  id: string
  lat: number
  lng: number
  radius: number
  kind: ZoneKind
  enabled?: boolean
}

interface Props {
  /** Where the phone is now. Drawn as a pink dot with its accuracy circle. */
  position?: { lat: number; lng: number; accuracy?: number | null } | null
  trail?: { lat: number; lng: number }[]
  zones?: MapZone[]
  /** A zone being placed or edited, drawn more strongly than saved ones. */
  preview?: { lat: number; lng: number; radius: number; kind: ZoneKind } | null
  onPick?: (lat: number, lng: number) => void
  label: string
  className?: string
}

/**
 * An OpenStreetMap view. Leaflet loads only when a map is first shown, so the calculator
 * never pays for it. Map tiles are fetched from OpenStreetMap, which therefore sees which
 * area is being looked at: this is noted in the threat model.
 */
export function MapView({ position, trail, zones, preview, onPick, label, className }: Props) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const layers = useRef<{ zones?: LayerGroup; preview?: Circle; trail?: Polyline; here?: CircleMarker; accuracy?: Circle }>({})
  const pick = useRef(onPick)
  const framed = useRef(false)
  const [library, setLibrary] = useState<typeof import('leaflet') | null>(null)
  const [failed, setFailed] = useState(false)
  pick.current = onPick

  useEffect(() => {
    let cancelled = false
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([L]) => {
        if (cancelled || !element.current) return
        const instance = L.map(element.current).setView(INDIA, 5)
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(instance)
        instance.on('click', (e: LeafletMouseEvent) => pick.current?.(e.latlng.lat, e.latlng.lng))
        map.current = instance
        setLibrary(L)
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
      layers.current = {}
    }
  }, [])

  useEffect(() => {
    const L = library
    if (!L || !map.current) return
    layers.current.zones?.remove()
    layers.current.zones = L.layerGroup(
      (zones ?? []).map((z) =>
        L.circle([z.lat, z.lng], {
          radius: z.radius,
          color: ZONE_COLOR[z.kind],
          weight: 2,
          dashArray: z.enabled === false ? '6 6' : undefined,
          fillOpacity: z.enabled === false ? 0.04 : 0.14,
          interactive: false,
        }),
      ),
    ).addTo(map.current)
  }, [library, zones])

  useEffect(() => {
    const L = library
    if (!L || !map.current) return
    layers.current.preview?.remove()
    layers.current.preview = preview
      ? L.circle([preview.lat, preview.lng], { radius: preview.radius, color: ZONE_COLOR[preview.kind], weight: 3, fillOpacity: 0.28, interactive: false }).addTo(map.current)
      : undefined
  }, [library, preview])

  useEffect(() => {
    const L = library
    if (!L || !map.current) return
    layers.current.trail?.remove()
    layers.current.trail = trail?.length
      ? L.polyline(trail.map((p) => [p.lat, p.lng] as [number, number]), { color: TRAIL_COLOR, weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map.current)
      : undefined
  }, [library, trail])

  useEffect(() => {
    const L = library
    if (!L || !map.current) return
    layers.current.here?.remove()
    layers.current.accuracy?.remove()
    layers.current.here = layers.current.accuracy = undefined
    if (position) {
      const at: [number, number] = [position.lat, position.lng]
      layers.current.accuracy = L.circle(at, { radius: position.accuracy ?? 0, color: HERE_COLOR, weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map.current)
      layers.current.here = L.circleMarker(at, { radius: 9, color: '#fff', weight: 4, fillColor: HERE_COLOR, fillOpacity: 1, interactive: false }).addTo(map.current)
    }
  }, [library, position])

  // Frame the map once, on the first thing worth looking at. Refitting on every update would make it jump.
  const focus = preview ?? position ?? trail?.[trail.length - 1] ?? zones?.[0] ?? null
  const hasFocus = focus !== null
  useEffect(() => {
    if (!library || !map.current || !focus || framed.current) return
    framed.current = true
    map.current.setView([focus.lat, focus.lng], 15)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, hasFocus])

  if (failed) {
    return (
      <div role="alert" className={cx('grid place-items-center rounded-card bg-fill p-6 text-center text-soft', className)}>
        The map couldn’t load. It needs a connection the first time.
      </div>
    )
  }
  return <div ref={element} role="application" aria-label={label} className={cx('overflow-hidden rounded-card bg-fill', className)} />
}
