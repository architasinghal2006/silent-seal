import { useState, type FormEvent } from 'react'
import { QuickExit } from '../components/QuickExit'
import { UNLOCK_SEQUENCE } from '../config'
import { api, clearToken } from '../lib/api'
import { createRecords } from '../lib/localUnlock'
import { setAccountId } from '../lib/storage'

const PIN_RE = /^\d{4,8}$/

function HowToOpen({ recoveryCode }: { recoveryCode?: string }) {
  return (
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
        A wrong PIN just shows the number, like a normal sum. If someone forces you to unlock, use your duress PIN: it
        opens an empty app and quietly alerts your trusted contacts. Both PINs also work with no connection.
      </p>
      {recoveryCode && (
        <>
          <h2>Your recovery code</h2>
          <p className="code-block">{recoveryCode}</p>
          <p className="muted">
            With this and your PIN you can get back to your evidence on any phone, even after wiping this one. Keep it
            somewhere away from this phone, or with someone you trust. You can see it again in Safety settings.
          </p>
        </>
      )}
    </section>
  )
}

function Restore({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const result = await api.unlock(code.trim(), pin)
    if (result === 'ok') {
      clearToken()
      setAccountId(code.trim())
      return onDone()
    }
    setBusy(false)
    setError(
      result === 'offline'
        ? 'Restoring needs a connection. Try again when you are online.'
        : "That code and PIN don't match. If you tried several times, wait a minute and try again.",
    )
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Use a recovery code</h2>
      <label>
        Recovery code
        <input className="input-text" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label>
        Your PIN
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
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Checking…' : 'Restore'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function Setup({ onDone, onExit }: { onDone: () => void; onExit: () => void }) {
  const [realPin, setRealPin] = useState('')
  const [duressPin, setDuressPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ recoveryCode?: string } | null>(null)
  const [restoring, setRestoring] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!PIN_RE.test(realPin) || !PIN_RE.test(duressPin)) return setError('PINs must be 4–8 digits.')
    if (realPin === duressPin) return setError('The two PINs must be different.')
    setBusy(true)
    try {
      const reply = await api.setup(realPin, duressPin)
      await createRecords(realPin, reply.offline_real, duressPin, reply.offline_duress)
      setAccountId(reply.account_id)
      // Asks the browser not to clear this data when space runs low. No prompt on most phones.
      void navigator.storage?.persist?.().catch(() => undefined)
      setDone({ recoveryCode: reply.account_id })
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
        <HowToOpen recoveryCode={done.recoveryCode} />
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
      {restoring ? (
        <Restore onDone={() => setDone({})} onCancel={() => setRestoring(false)} />
      ) : (
        <>
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
          <button type="button" className="btn btn-secondary" onClick={() => setRestoring(true)}>
            I have a recovery code
          </button>
        </>
      )}
    </main>
  )
}
