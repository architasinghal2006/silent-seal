import { useEffect, useRef, useState } from 'react'
import type { Circle, LeafletMouseEvent, Map as LeafletMap } from 'leaflet'
import type { Zone } from '../lib/api'

const INDIA: [number, number] = [20.6, 78.9]

interface Props {
  center: { lat: number; lng: number } | null
  radius: number
  kind: 'danger' | 'safe'
  zones: Zone[]
  onPick: (lat: number, lng: number) => void
}

const COLOR = { danger: '#ff453a', safe: '#30d158' }

/** Leaflet loads only when this screen opens, so the calculator never pays for it. */
export function ZoneMap({ center, radius, kind, zones, onPick }: Props) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const preview = useRef<Circle | null>(null)
  const saved = useRef<Circle[]>([])
  const pick = useRef(onPick)
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
        instance.on('click', (e: LeafletMouseEvent) => pick.current(e.latlng.lat, e.latlng.lng))
        map.current = instance
        setLibrary(L)
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!library || !map.current) return
    saved.current.forEach((c) => c.remove())
    saved.current = zones.map((z) =>
      library.circle([z.lat, z.lng], { radius: z.radius, color: COLOR[z.kind], weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map.current!),
    )
  }, [library, zones])

  useEffect(() => {
    if (!library || !map.current) return
    preview.current?.remove()
    preview.current = null
    if (center) {
      preview.current = library
        .circle([center.lat, center.lng], { radius, color: COLOR[kind], weight: 2, fillOpacity: 0.25, interactive: false })
        .addTo(map.current)
    }
  }, [library, center, radius, kind])

  const hasCenter = center !== null
  useEffect(() => {
    if (map.current && center) map.current.setView([center.lat, center.lng], Math.max(map.current.getZoom(), 15))
    // Only when a place is first chosen: refitting on every tap would make the map jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, hasCenter])

  if (failed) return <p className="error">The map couldn't load. Use your current location instead.</p>
  return <div ref={element} className="zone-map" aria-label="Map. Tap to choose the middle of the zone." />
}
