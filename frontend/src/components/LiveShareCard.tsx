import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { stopStream } from '../lib/stream'

/** Only ever appears in a real session: the server reports no share to a duress session. */
export function LiveShareCard() {
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.liveStatus().then((s) => setExpiresAt(s.active ? s.expires_at : null)).catch(() => undefined)
  }, [])

  if (!expiresAt) return null

  const until = new Date(expiresAt + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  async function confirmSafe() {
    setBusy(true)
    setError('')
    try {
      await api.imSafe()
      stopStream()
      setExpiresAt(null)
    } catch {
      setError('Could not end sharing, so your contacts can still see your location. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card live-card">
      <h2>Your contacts can see your location</h2>
      <p className="muted">Sharing stops at {until} or when you say you're safe. Keep this app open so the map stays up to date.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {confirming ? (
        <>
          <p>This ends your live map and tells your contacts you're safe.</p>
          <div className="live-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirmSafe()}>
              {busy ? 'Ending…' : 'Yes, end sharing'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Keep sharing
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>
          I'm safe
        </button>
      )}
    </section>
  )
}
