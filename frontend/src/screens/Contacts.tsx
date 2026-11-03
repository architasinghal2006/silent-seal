import { useEffect, useState, type FormEvent } from 'react'
import { QuickExit } from '../components/QuickExit'
import { api, type Contact, type ContactInput } from '../lib/api'

const PHONE_RE = /^\+?\d{7,15}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const EMPTY: ContactInput = { name: '', phone: '', email: '', channel: 'sms' }

function validate(form: ContactInput): string {
  if (!form.name.trim()) return 'Enter a name.'
  if (form.channel === 'sms' && !PHONE_RE.test(form.phone ?? '')) return 'Enter a phone number, like +919800000001.'
  if (form.channel === 'email' && !EMAIL_RE.test(form.email ?? '')) return 'Enter an email address.'
  return ''
}

/** Sends only the field the chosen channel uses, plus the other one if it is filled in validly. */
function toPayload(form: ContactInput): ContactInput {
  return {
    name: form.name.trim(),
    channel: form.channel,
    phone: PHONE_RE.test(form.phone ?? '') ? form.phone : null,
    email: EMAIL_RE.test(form.email ?? '') ? form.email : null,
  }
}

export function Contacts({ onBack, onExit }: { onBack: () => void; onExit: () => void }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [alertName, setAlertName] = useState('')
  const [form, setForm] = useState<ContactInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.contacts().then(setContacts).catch(() => setError('Could not load your contacts. Check your connection.'))
    api.profile().then((p) => setAlertName((typed) => typed || p.alert_name)).catch(() => undefined)
  }, [])

  function edit(contact: Contact | null) {
    setError('')
    setEditingId(contact?.id ?? null)
    setForm(contact ? { ...contact, phone: contact.phone ?? '', email: contact.email ?? '' } : EMPTY)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    const problem = validate(form)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      const payload = toPayload(form)
      if (editingId) {
        const saved = await api.updateContact(editingId, payload)
        setContacts((list) => (list ?? []).map((c) => (c.id === saved.id ? saved : c)))
      } else {
        const saved = await api.createContact(payload)
        setContacts((list) => [...(list ?? []), saved])
      }
      setForm(null)
    } catch {
      setError('Could not save. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(contact: Contact) {
    setError('')
    try {
      await api.deleteContact(contact.id)
      setContacts((list) => (list ?? []).filter((c) => c.id !== contact.id))
    } catch {
      setError('Could not remove that contact. Check your connection and try again.')
    }
  }

  return (
    <main className="screen">
      <QuickExit onExit={onExit} />
      <button type="button" className="link-back" onClick={onBack}>
        Back
      </button>
      <h1>Trusted contacts</h1>
      <p className="muted">They get your alerts. Tell them not to call or text you back after one, as that could put you at risk.</p>

      <section className="card form">
        <label>
          Your name in alerts
          <input
            className="input-text"
            maxLength={80}
            autoComplete="off"
            value={alertName}
            onChange={(e) => setAlertName(e.target.value)}
            onBlur={() => void api.saveProfile(alertName).catch(() => setError('Could not save your name. Check your connection and try again.'))}
          />
          <small className="muted">So your contacts know who needs help.</small>
        </label>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      {contacts && contacts.length === 0 && !form && (
        <p className="muted">No contacts yet. Alerts won't reach anyone until you add one.</p>
      )}

      {contacts && contacts.length > 0 && (
        <ul className="contact-list">
          {contacts.map((c) => (
            <li key={c.id} className="card contact">
              <div>
                <strong>{c.name}</strong>
                <span className="muted">
                  {c.channel === 'sms' ? `SMS ${c.phone}` : `Email ${c.email}`}
                </span>
              </div>
              <div className="contact-actions">
                <button type="button" className="btn btn-secondary" onClick={() => edit(c)}>
                  Edit
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => void remove(c)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form ? (
        <form className="card form" onSubmit={submit}>
          <h2>{editingId ? 'Edit contact' : 'Add contact'}</h2>
          <label>
            Name
            <input
              className="input-text"
              maxLength={80}
              autoComplete="off"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Send alerts by
            <select
              className="input-text"
              value={form.channel}
              onChange={(e) => setForm({ ...form, channel: e.target.value as ContactInput['channel'] })}
            >
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </label>
          {form.channel === 'sms' ? (
            <label>
              Phone number
              <input
                className="input-text"
                type="tel"
                autoComplete="off"
                value={form.phone ?? ''}
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[\s-]/g, '') })}
              />
            </label>
          ) : (
            <label>
              Email address
              <input
                className="input-text"
                type="email"
                autoComplete="off"
                value={form.email ?? ''}
                onChange={(e) => setForm({ ...form, email: e.target.value.trim() })}
              />
            </label>
          )}
          <div className="contact-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save contact'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        contacts && (
          <button type="button" className="btn btn-primary" onClick={() => edit(null)}>
            Add contact
          </button>
        )
      )}
    </main>
  )
}
