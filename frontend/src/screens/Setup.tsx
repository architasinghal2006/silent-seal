import { useState, type FormEvent } from 'react'
import { QuickExit } from '../components/QuickExit'
import { UNLOCK_SEQUENCE } from '../config'
import { api } from '../lib/api'
import { setAccountId } from '../lib/storage'

const PIN_RE = /^\d{4,8}$/

export function Setup({ onDone, onExit }: { onDone: () => void; onExit: () => void }) {
  const [realPin, setRealPin] = useState('')
  const [duressPin, setDuressPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!PIN_RE.test(realPin) || !PIN_RE.test(duressPin)) return setError('PINs must be 4–8 digits.')
    if (realPin === duressPin) return setError('The two PINs must be different.')
    setBusy(true)
    try {
      const { account_id } = await api.setup(realPin, duressPin)
      setAccountId(account_id)
      setDone(true)
    } catch {
      setError('Could not reach the server. Try again when you are online.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <main className="screen">
        <QuickExit onExit={onExit} />
        <h1>You're set up</h1>
        <section className="card">
          <p>To open this app from the calculator:</p>
          <ol>
            <li>
              Type <code>{UNLOCK_SEQUENCE}</code> and press <code>=</code>
            </li>
            <li>
              Type your PIN and press <code>=</code>
            </li>
          </ol>
          <p className="muted">
            A wrong PIN just shows the number, like a normal sum. If someone forces you to unlock, use your
            duress PIN: it opens an empty app and quietly alerts your trusted contacts.
          </p>
        </section>
        <button type="button" className="btn btn-primary" onClick={onDone}>
          Back to calculator
        </button>
      </main>
    )
  }

  return (
    <main className="screen">
      <QuickExit onExit={onExit} />
      <h1>First-time setup</h1>
      <form className="card form" onSubmit={submit}>
        <label>
          Your PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={realPin}
            onChange={(e) => setRealPin(e.target.value.replace(/\D/g, ''))}
          />
          <small className="muted">Opens the full app.</small>
        </label>
        <label>
          Duress PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={duressPin}
            onChange={(e) => setDuressPin(e.target.value.replace(/\D/g, ''))}
          />
          <small className="muted">
            Use this if you are ever forced to unlock. It shows an empty app and silently sends an SOS.
          </small>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </main>
  )
}
