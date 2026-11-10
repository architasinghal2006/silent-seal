import { Mail, Pencil, Phone, Plus, Trash2, Users } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, IconButton } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { ConfirmDialog, Sheet } from '../components/ui/Dialog'
import { SelectField, Switch, TextField } from '../components/ui/Field'
import { SkeletonList } from '../components/ui/Spinner'
import { EmptyState, ErrorState, Notice } from '../components/ui/States'
import { Avatar, StatusChip } from '../components/ui/StatusChip'
import { useSession } from '../contexts/SessionContext'
import { useToast } from '../contexts/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { api } from '../services/api'
import type { Channel, Contact, ContactInput } from '../types/api'
import { EMAIL_PATTERN, PHONE_PATTERN } from '../utils/validation'

const EMPTY: ContactInput = { name: '', relationship: '', phone: '', email: '', channel: 'sms', is_emergency: true }

function validate(form: ContactInput): string {
  if (!form.name.trim()) return 'Enter a name.'
  if (form.channel === 'sms' && !PHONE_PATTERN.test(form.phone ?? '')) return 'Enter a phone number with country code, like +919800000001.'
  if (form.channel === 'email' && !EMAIL_PATTERN.test(form.email ?? '')) return 'Enter an email address.'
  return ''
}

/** Sends only the field the chosen channel uses, plus the other one if it is filled in validly. */
function toPayload(form: ContactInput): ContactInput {
  return {
    name: form.name.trim(),
    relationship: form.relationship.trim(),
    channel: form.channel,
    phone: PHONE_PATTERN.test(form.phone ?? '') ? form.phone : null,
    email: EMAIL_PATTERN.test(form.email ?? '') ? form.email : null,
    is_emergency: form.is_emergency,
  }
}

function ContactForm({ initial, onSaved, onClose }: { initial: Contact | null; onSaved: (contact: Contact) => void; onClose: () => void }) {
  const [form, setForm] = useState<ContactInput>(initial ? { ...initial, phone: initial.phone ?? '', email: initial.email ?? '' } : EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validate(form)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      const payload = toPayload(form)
      onSaved(initial ? await api.updateContact(initial.id, payload) : await api.createContact(payload))
    } catch {
      setError('Could not save. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <Sheet title={initial ? 'Edit contact' : 'Add a trusted contact'} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <TextField label="Name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextField label="Relationship" value={form.relationship} maxLength={40} placeholder="Sister, friend, counsellor…" onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
        <SelectField label="Send alerts by" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as Channel })}>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
        </SelectField>
        {form.channel === 'sms' ? (
          <TextField label="Phone number" type="tel" inputMode="tel" placeholder="+919800000001" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[\s-]/g, '') })} />
        ) : (
          <TextField label="Email address" type="email" inputMode="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value.trim() })} />
        )}
        <Switch
          label="Emergency contact"
          hint="Gets your SOS alerts and live location. Turn off to keep someone listed without alerting them."
          checked={form.is_emergency}
          onChange={(on) => setForm({ ...form, is_emergency: on })}
        />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap gap-3 pt-1">
          <Button type="submit" loading={busy} className="flex-1">
            {busy ? 'Saving…' : 'Save contact'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

export function Contacts() {
  const { offline } = useSession()
  const toast = useToast()
  const contacts = useAsync(() => api.contacts(), [], !offline)
  const [alertName, setAlertName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [editing, setEditing] = useState<Contact | 'new' | null>(null)
  const [removing, setRemoving] = useState<Contact | null>(null)
  const [busy, setBusy] = useState(false)
  const [removeError, setRemoveError] = useState('')

  useEffect(() => {
    if (offline) return
    api.profile().then((p) => {
      setSavedName(p.alert_name)
      setAlertName((typed) => typed || p.alert_name)
    }).catch(() => undefined)
  }, [offline])

  async function saveName() {
    const name = alertName.trim()
    if (name === savedName) return
    try {
      await api.saveProfile(name)
      setSavedName(name)
      toast('Name saved')
    } catch {
      toast('Could not save your name. Check your connection.', 'error')
    }
  }

  function saved(contact: Contact) {
    contacts.setData((list) => {
      const current = list ?? []
      return current.some((c) => c.id === contact.id) ? current.map((c) => (c.id === contact.id ? contact : c)) : [...current, contact]
    })
    setEditing(null)
    toast('Contact saved')
  }

  async function remove() {
    if (!removing) return
    setBusy(true)
    setRemoveError('')
    try {
      await api.deleteContact(removing.id)
      contacts.setData((list) => (list ?? []).filter((c) => c.id !== removing.id))
      setRemoving(null)
      toast('Contact removed')
    } catch {
      setRemoveError('Could not remove that contact. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const list = contacts.data

  return (
    <div className="grid gap-4">
      <PageHeader title="Trusted contacts" subtitle="The people who get your alerts. Ask them not to call or text back after one: a reply could put you at risk." />

      {offline ? (
        <Notice tone="warn">Your contacts can’t be shown or changed without a connection. Alerts you send offline still go to them once you’re back online.</Notice>
      ) : (
        <>
          <Card>
            <TextField
              label="Your name in alerts"
              value={alertName}
              maxLength={80}
              onChange={(e) => setAlertName(e.target.value)}
              onBlur={() => void saveName()}
              hint="So your contacts know who needs help. Saved when you leave the box."
            />
          </Card>

          {contacts.loading && !list && <SkeletonList />}
          {contacts.failed && <ErrorState onRetry={contacts.reload}>Couldn’t load your contacts.</ErrorState>}

          {list && list.length === 0 && (
            <EmptyState
              icon={<Users size={28} />}
              title="No trusted contacts yet"
              action={
                <Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEditing('new')}>
                  Add a contact
                </Button>
              }
            >
              An alert can’t reach anyone until you add someone you trust.
            </EmptyState>
          )}

          {list && list.length > 0 && (
            <>
              <ul className="grid gap-3">
                {list.map((c) => (
                  <Card as="li" key={c.id} className="flex items-center gap-3 p-4">
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        <span className="truncate">{c.name}</span>
                        {c.is_emergency ? <StatusChip tone="ok">Emergency</StatusChip> : <StatusChip>Not alerted</StatusChip>}
                      </p>
                      {c.relationship && <p className="text-sm text-soft">{c.relationship}</p>}
                      <p className="flex items-center gap-1.5 truncate text-sm text-soft">
                        {c.channel === 'sms' ? <Phone size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}
                        <span className="sr-only">{c.channel === 'sms' ? 'SMS to' : 'Email to'}</span>
                        {c.channel === 'sms' ? c.phone : c.email}
                      </p>
                    </div>
                    <IconButton label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                      <Pencil size={18} aria-hidden="true" />
                    </IconButton>
                    <IconButton label={`Remove ${c.name}`} onClick={() => setRemoving(c)}>
                      <Trash2 size={18} aria-hidden="true" />
                    </IconButton>
                  </Card>
                ))}
              </ul>
              <Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEditing('new')}>
                Add a contact
              </Button>
            </>
          )}
        </>
      )}

      {editing && <ContactForm initial={editing === 'new' ? null : editing} onSaved={saved} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove contact"
          busyLabel="Removing…"
          danger
          busy={busy}
          error={removeError}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(null)}
        >
          <p>They will no longer get your alerts or see your live location.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
