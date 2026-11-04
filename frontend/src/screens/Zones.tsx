import { useEffect, useState, type FormEvent } from 'react'
import { QuickExit } from '../components/QuickExit'
import { ZoneMap } from '../components/ZoneMap'
import { api, type Zone, type ZoneList } from '../lib/api'
import { readLocationSilently, requestLocationPermission } from '../lib/device'
import { updateWatch } from '../lib/watcher'

const KIND_LABEL = { danger: 'Danger zone', safe: 'Safe zone' }

export function Zones({ onBack, onExit }: { onBack: () => void; onExit: () => void }) {
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'danger' | 'safe'>('danger')
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [radius, setRadius] = useState(200)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function apply(reply: ZoneList) {
    setZones(reply.zones)
    updateWatch(reply.watch, reply.watch_token)
  }

  useEffect(() => {
    api.zones().then(apply).catch(() => setError('Could not load your zones. Check your connection.'))
  }, [])

  async function useMyLocation() {
    setError('')
    setBusy(true)
    await requestLocationPermission()
    const here = await readLocationSilently()
    setBusy(false)
    if (here) setCenter({ lat: here.lat, lng: here.lng })
    else setError("Couldn't get your location. You can tap the map instead.")
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Give this zone a name.')
    if (!center) return setError('Tap the map to choose where this zone is.')
    setBusy(true)
    setError('')
    try {
      apply(await api.createZone({ name: name.trim(), kind, lat: center.lat, lng: center.lng, radius }))
      setAdding(false)
      setName('')
      setCenter(null)
      // Back to defaults, so the next zone can't silently inherit the wrong type.
      setKind('danger')
      setRadius(200)
    } catch {
      setError('Could not save this zone. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(zone: Zone) {
    setError('')
    try {
      apply(await api.deleteZone(zone.id))
    } catch {
      setError('Could not remove that zone. Check your connection and try again.')
    }
  }

  return (
    <main className="screen">
      <QuickExit onExit={onExit} />
      <button type="button" className="link-back" onClick={onBack}>
        Back
      </button>
      <h1>Safe & danger zones</h1>
      <p className="muted">
        Your contacts get a silent alert when you enter a danger zone or leave a safe zone. This only works while
        this app is open, even on the calculator, and location is allowed.
      </p>

      {error && <p className="error" role="alert">{error}</p>}

      {zones && zones.length === 0 && !adding && <p className="muted">No zones yet.</p>}

      {zones && zones.length > 0 && (
        <ul className="contact-list">
          {zones.map((z) => (
            <li key={z.id} className="card contact">
              <div>
                <strong>{z.name}</strong>
                <span className="muted">
                  {KIND_LABEL[z.kind]}, {z.radius} m around the point you chose
                </span>
              </div>
              <div className="contact-actions">
                <button type="button" className="btn btn-secondary" onClick={() => void remove(z)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="card form" onSubmit={save}>
          <h2>Add a zone</h2>
          <label>
            Name
            <input className="input-text" maxLength={80} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            <small className="muted">Only you see this. Pick something that won't give anything away.</small>
          </label>
          <label>
            Type
            <select className="input-text" value={kind} onChange={(e) => setKind(e.target.value as 'danger' | 'safe')}>
              <option value="danger">Danger zone: alert when I enter</option>
              <option value="safe">Safe zone: alert when I leave</option>
            </select>
          </label>
          <ZoneMap center={center} radius={radius} kind={kind} zones={zones ?? []} onPick={(lat, lng) => setCenter({ lat, lng })} />
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void useMyLocation()}>
            Use my current location
          </button>
          <p className="muted">
            {center ? `Chosen: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}` : 'Tap the map to choose the middle of the zone.'}
          </p>
          <label>
            Size: {radius} m around that point
            <input type="range" min={50} max={2000} step={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
          </label>
          <div className="contact-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save zone'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        zones && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Add a zone
          </button>
        )
      )}
    </main>
  )
}
