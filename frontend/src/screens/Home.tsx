import { useEffect, useState } from 'react'
import { Helplines } from '../components/Helplines'
import { LiveShareCard } from '../components/LiveShareCard'
import { QuickExit } from '../components/QuickExit'
import { HoldButton } from '../components/HoldButton'
import { api, type SosHistoryItem } from '../lib/api'
import { locationPermission, requestLocationPermission, type LocationPermission } from '../lib/device'
import { fireSos } from '../lib/sos'

const TRIGGER_LABEL: Record<string, string> = { manual: 'Alert', duress: 'Duress PIN', geofence: 'Zone' }

function outcome(item: SosHistoryItem) {
  if (item.status === 'no_contacts') return 'Nobody was alerted: no contacts at that time'
  if (item.delivered === 0) return 'Not delivered'
  const failed = item.undelivered ? `, ${item.undelivered} not delivered` : ''
  return `Sent to ${item.delivered} ${item.delivered === 1 ? 'contact' : 'contacts'}${failed}`
}

export function Home({
  offline,
  onExit,
  onWipe,
  onContacts,
  onVault,
  onZones,
  onSafety,
}: {
  offline: boolean
  onExit: () => void
  onWipe: () => void
  onContacts: () => void
  onVault: () => void
  onZones: () => void
  onSafety: () => void
}) {
  const [contactCount, setContactCount] = useState<number | null>(null)
  const [history, setHistory] = useState<SosHistoryItem[]>([])
  const [permission, setPermission] = useState<LocationPermission>('granted')

  useEffect(() => {
    if (offline) return
    api.contacts().then((c) => setContactCount(c.length)).catch(() => undefined)
    api.sosHistory().then(setHistory).catch(() => undefined)
    locationPermission().then(setPermission)
  }, [offline])

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

      {offline ? (
        <section className="card live-card" role="status">
          <h2>You're offline</h2>
          <p className="muted">
            You can still send alerts and add evidence. They wait safely on this phone and go as soon as you're back
            online. To see your contacts or your full vault, exit and unlock again once you have a connection.
          </p>
        </section>
      ) : (
        <LiveShareCard />
      )}

      <section className="card">
        <HoldButton label="Hold to send silent alert" onFire={sendAlert} />
        <p className="muted">
          Hold for 2 seconds. Your trusted contacts get a private live map of your location, with no sound
          or message on this phone, and you return to the calculator.
        </p>
        {!offline && contactCount === 0 && (
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
        <button type="button" className="tile" disabled={offline} onClick={onContacts}>
          <strong>Trusted contacts</strong>
          <span>People who receive your alerts.</span>
          <em>{contactCount === null ? '' : `${contactCount} added`}</em>
        </button>
        <button type="button" className="tile" onClick={onVault}>
          <strong>Evidence vault</strong>
          <span>Encrypted notes, photos and audio.</span>
        </button>
        <button type="button" className="tile" disabled={offline} onClick={onZones}>
          <strong>Safe & danger zones</strong>
          <span>Automatic alerts by location.</span>
        </button>
        <button type="button" className="tile" disabled={offline} onClick={onSafety}>
          <strong>Safety settings</strong>
          <span>Recovery code and deleting your data.</span>
        </button>
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

      <section className="card">
        <h2>Panic wipe</h2>
        <HoldButton label="Hold to wipe this phone" tone="quiet" onFire={onWipe} />
        <p className="muted">
          Hold for 2 seconds. This erases the app's data from this phone and returns to a fresh calculator, so anything
          still waiting to send is lost and live location stops. Your evidence stays safe on the server, and you can get
          back to it with your recovery code. Files you exported to Downloads have to be deleted separately.
        </p>
      </section>
    </main>
  )
}
