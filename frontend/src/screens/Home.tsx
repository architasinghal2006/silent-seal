import { useEffect, useState } from 'react'
import { Helplines } from '../components/Helplines'
import { QuickExit } from '../components/QuickExit'
import { SosButton } from '../components/SosButton'
import { api, type SosHistoryItem } from '../lib/api'
import { locationPermission, requestLocationPermission, type LocationPermission } from '../lib/device'
import { fireSos } from '../lib/sos'

// Modules land in later phases; the tiles show what's coming.
const COMING = [
  { title: 'Live location', desc: 'Share a private, expiring map link.' },
  { title: 'Evidence vault', desc: 'Encrypted notes, photos and audio.' },
  { title: 'Safe & danger zones', desc: 'Automatic alerts by location.' },
]

const TRIGGER_LABEL: Record<string, string> = { manual: 'Alert', duress: 'Duress PIN', geofence: 'Zone' }

function outcome(item: SosHistoryItem) {
  if (item.status === 'no_contacts') return 'Nobody was alerted: no contacts at that time'
  if (item.delivered === 0) return 'Not delivered'
  const failed = item.undelivered ? `, ${item.undelivered} not delivered` : ''
  return `Sent to ${item.delivered} ${item.delivered === 1 ? 'contact' : 'contacts'}${failed}`
}

export function Home({ onExit, onContacts }: { onExit: () => void; onContacts: () => void }) {
  const [contactCount, setContactCount] = useState<number | null>(null)
  const [history, setHistory] = useState<SosHistoryItem[]>([])
  const [permission, setPermission] = useState<LocationPermission>('granted')

  useEffect(() => {
    api.contacts().then((c) => setContactCount(c.length)).catch(() => undefined)
    api.sosHistory().then(setHistory).catch(() => undefined)
    locationPermission().then(setPermission)
  }, [])

  function sendAlert() {
    fireSos()
    // Back to the calculator at once: the screen gives no sign that anything was sent.
    onExit()
  }

  return (
    <main className="screen">
      <QuickExit onExit={onExit} />
      <h1>Silent Seal</h1>
      <p className="muted">Everything here is private to you. Press Exit or Esc any time to return to the calculator.</p>

      <section className="card">
        <SosButton onFire={sendAlert} />
        <p className="muted">
          Hold for 2 seconds. Your trusted contacts get your location and battery level, with no sound or
          message on this phone, and you return to the calculator.
        </p>
        {contactCount === 0 && (
          <p className="warning" role="status">
            You have no trusted contacts yet, so an alert won't reach anyone.
          </p>
        )}
        {permission === 'prompt' && (
          <div className="inline-action">
            <p className="warning">Location is off, so alerts won't say where you are.</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => requestLocationPermission().then(setPermission)}
            >
              Allow location
            </button>
          </div>
        )}
        {permission === 'denied' && (
          <p className="warning" role="status">
            Location is blocked, so alerts won't say where you are. You can allow it in your browser's site
            settings.
          </p>
        )}
      </section>

      <div className="tiles">
        <button type="button" className="tile" onClick={onContacts}>
          <strong>Trusted contacts</strong>
          <span>People who receive your alerts.</span>
          <em>{contactCount === null ? '' : `${contactCount} added`}</em>
        </button>
        {COMING.map((m) => (
          <button key={m.title} type="button" className="tile" disabled>
            <strong>{m.title}</strong>
            <span>{m.desc}</span>
            <em>Coming soon</em>
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <section className="card">
          <h2>Recent alerts</h2>
          <ul className="history">
            {history.map((item) => (
              <li key={item.created_at}>
                <span>
                  {TRIGGER_LABEL[item.trigger] ?? 'Alert'}, {new Date(item.created_at + 'Z').toLocaleString()}
                </span>
                <span className={item.delivered ? 'muted' : 'warning'}>{outcome(item)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Helplines />
    </main>
  )
}
