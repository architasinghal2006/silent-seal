import { useState, type FormEvent } from 'react'
import { QuickExit } from '../components/QuickExit'
import { api, ApiError } from '../lib/api'
import { getAccountId } from '../lib/storage'

const PIN_RE = /^\d{4,8}$/

interface Props {
  onBack: () => void
  onExit: () => void
  /** Runs after the server copy is gone, to clear the phone too. */
  onErased: () => void
}

export function Safety({ onBack, onExit, onErased }: Props) {
  const [showCode, setShowCode] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function erase(e: FormEvent) {
    e.preventDefault()
    if (!PIN_RE.test(pin)) return setError('Type your PIN to confirm.')
    setBusy(true)
    setError('')
    try {
      await api.eraseAccount(pin)
      onErased()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That PIN isn't right, so nothing was deleted."
          : 'Could not reach the server, so nothing was deleted. Check your connection and try again.',
      )
      setBusy(false)
    }
  }

  return (
    <main className="screen">
      <QuickExit onExit={onExit} />
      <button type="button" className="link-back" onClick={onBack}>
        Back
      </button>
      <h1>Safety settings</h1>

      <section className="card">
        <h2>Recovery code</h2>
        <p className="muted">
          With this code and your PIN you can get back to your evidence on any phone, including after a panic wipe.
          Keep a copy somewhere away from this phone, or with someone you trust.
        </p>
        {showCode && <p className="code-block">{getAccountId()}</p>}
        <button type="button" className="btn btn-secondary" onClick={() => setShowCode((s) => !s)}>
          {showCode ? 'Hide code' : 'Show code'}
        </button>
      </section>

      <section className="card">
        <h2>Delete everything from the server</h2>
        <p className="muted">
          Permanently deletes your evidence, location history, alerts, zones and contacts, and ends any live map. This
          can't be undone, and the recovery code stops working. Files you exported are not affected.
        </p>
        {confirming ? (
          <form className="form" onSubmit={erase}>
            <label>
              Type your PIN to confirm
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="contact-actions">
              <button type="submit" className="btn btn-danger" disabled={busy}>
                {busy ? 'Deleting…' : 'Delete everything'}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
            Delete from server…
          </button>
        )}
      </section>
    </main>
  )
}
