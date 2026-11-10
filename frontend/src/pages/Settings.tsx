import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Helplines } from '../components/Helplines'
import { Button } from '../components/ui/Button'
import { Card, CardTitle, PageHeader } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/Dialog'
import { DigitsField, Switch } from '../components/ui/Field'
import { HoldBar } from '../components/ui/HoldRing'
import { Notice } from '../components/ui/States'
import { StatusChip } from '../components/ui/StatusChip'
import { useSession } from '../contexts/SessionContext'
import { useToast } from '../contexts/ToastContext'
import { saveSequence, sequenceProblem } from '../crypto/sequence'
import { useGeolocation } from '../hooks/useGeolocation'
import { useQueueStatus } from '../hooks/useOnline'
import { api, ApiError } from '../services/api'
import { PIN_PATTERN } from '../utils/config'
import { plural } from '../utils/format'
import { getStayOnStatus, getUserId, setStayOnStatus } from '../utils/storage'

export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-full px-2 text-[15px] font-semibold text-soft hover:text-ink">
      <ArrowLeft size={18} aria-hidden="true" /> {children}
    </Link>
  )
}

function ChangeSequence() {
  const toast = useToast()
  const [sequence, setSequence] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = sequenceProblem(sequence)
    if (problem) return setError(problem)
    await saveSequence(sequence)
    setSequence('')
    setError('')
    toast('Secret sequence changed')
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <DigitsField label="New secret sequence" value={sequence} onValue={setSequence} error={error} hint="4 to 8 digits. Typed on the calculator, then =, to reach the PIN. Kept on this phone only." />
      <Button type="submit" variant="secondary" className="justify-self-start">
        Change sequence
      </Button>
    </form>
  )
}

export function Settings() {
  const { offline, demo, wipe } = useSession()
  const toast = useToast()
  const { permission, request } = useGeolocation()
  const queue = useQueueStatus()
  const [stay, setStay] = useState(getStayOnStatus)
  const [showCode, setShowCode] = useState(false)
  const [erasing, setErasing] = useState(false)
  const [pin, setPin] = useState('')
  const [eraseError, setEraseError] = useState('')
  const [busy, setBusy] = useState('')

  async function erase() {
    if (!PIN_PATTERN.test(pin)) return setEraseError('Type your PIN to confirm.')
    setBusy('erase')
    setEraseError('')
    try {
      await api.eraseAccount(pin)
      wipe()
    } catch (err) {
      setEraseError(
        err instanceof ApiError && err.status === 401
          ? 'That PIN isn’t right, so nothing was deleted.'
          : 'Could not reach the server, so nothing was deleted. Check your connection and try again.',
      )
      setBusy('')
    }
  }

  async function loadSamples() {
    setBusy('sample')
    try {
      const position = await new Promise<GeolocationPosition | null>((resolve) =>
        permission === 'granted' ? navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 4000 }) : resolve(null),
      )
      await api.loadSampleData(position ? { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy } : null)
      toast('Sample data added')
    } catch {
      toast('Could not add sample data', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="grid gap-4">
      <BackLink to="/">Home</BackLink>
      <PageHeader title="Safety and settings" />

      <Helplines />

      <Card aria-labelledby="privacy-title">
        <CardTitle id="privacy-title">Your privacy</CardTitle>
        <ul className="grid list-disc gap-2 pl-5 text-[15px] text-soft">
          <li>Nothing is shared unless you send an alert, start sharing, or a zone you set up is crossed.</li>
          <li>Evidence is encrypted on this phone. The server stores only ciphertext and cannot read it.</li>
          <li>The server does store your contacts, zones and, during a share, your location trail, so that alerts can be sent.</li>
          <li>No analytics, no advertising, no account name or email. Your recovery code is the only identifier.</li>
          <li>This app can’t hide that it is installed, stop screenshots, or control what the phone’s app switcher shows.</li>
        </ul>
      </Card>

      <Card aria-labelledby="permissions-title">
        <CardTitle id="permissions-title">Permissions</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Location</p>
            <p className="text-sm text-soft">Used for alerts, live sharing and zones, and only while this app is open.</p>
          </div>
          {permission === 'granted' && <StatusChip tone="ok">Allowed</StatusChip>}
          {permission === 'denied' && <StatusChip tone="warn">Blocked in browser settings</StatusChip>}
          {permission === 'unsupported' && <StatusChip tone="warn">Not available</StatusChip>}
          {permission === 'prompt' && (
            <Button variant="secondary" size="sm" onClick={() => void request()}>
              Allow location
            </Button>
          )}
        </div>
        <p className="mt-3 border-t border-line pt-3 text-sm text-soft">Microphone and photos are asked for only when you record or add a photo in the vault.</p>
      </Card>

      <Card aria-labelledby="security-title" className="grid gap-5">
        <CardTitle id="security-title">Security</CardTitle>
        <div className="-mt-3">
          <ChangeSequence />
        </div>
        <div className="border-t border-line pt-4">
          <Switch
            label="Stay on the status screen after an alert"
            hint="Off: the app returns to the calculator at once and shows nothing. On: you see each step confirmed, which is easier to notice over your shoulder."
            checked={stay}
            onChange={(on) => {
              setStayOnStatus(on)
              setStay(on)
            }}
          />
        </div>
        <div className="border-t border-line pt-4">
          <p className="font-semibold">Quick exit</p>
          <p className="text-sm text-soft">
            The Exit button, the Esc key, switching away from the app, or five minutes without a touch all lock the app and return to the calculator.
            Decrypted evidence and your session are dropped from memory.
          </p>
        </div>
        <Link to="/settings/sync" className="-mx-2 flex min-h-12 items-center gap-3 rounded-control border-t border-line px-2 pt-4 hover:bg-bg">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Sync status</span>
            <span className="block text-sm text-soft">{queue.waiting ? `${plural(queue.waiting, 'item')} waiting to send` : 'Nothing waiting on this phone'}</span>
          </span>
          <ChevronRight size={18} className="text-muted" aria-hidden="true" />
        </Link>
      </Card>

      <Card aria-labelledby="recovery-title">
        <CardTitle id="recovery-title">Recovery code</CardTitle>
        <p className="text-[15px] text-soft">With this code and your PIN you can reach your evidence from any phone, including after a panic wipe. Keep a copy away from this phone, or with someone you trust.</p>
        {showCode && <p className="mt-3 select-all break-all rounded-control bg-bg px-4 py-3 font-mono text-sm">{getUserId()}</p>}
        <Button variant="secondary" className="mt-3" aria-expanded={showCode} onClick={() => setShowCode((s) => !s)}>
          {showCode ? 'Hide code' : 'Show code'}
        </Button>
      </Card>

      {demo && (
        <Card tone="blush" aria-labelledby="demo-title">
          <CardTitle id="demo-title" action={<StatusChip tone="simulated">Demo server</StatusChip>}>
            Demonstration
          </CardTitle>
          <p className="text-[15px] text-pink-ink">
            This server runs in demo mode. Notifications are recorded, not sent. You can fill this account with sample contacts, zones and past alerts, all marked as samples.
          </p>
          <Button variant="secondary" className="mt-3 bg-white" loading={busy === 'sample'} disabled={offline} onClick={() => void loadSamples()}>
            Load sample data
          </Button>
        </Card>
      )}

      <Card aria-labelledby="wipe-title" className="grid gap-3">
        <CardTitle id="wipe-title">Panic wipe</CardTitle>
        <p className="-mt-2 text-[15px] text-soft">
          Hold for 2 seconds. This clears the app’s data from this phone and returns to a fresh calculator: your account link, offline PINs, secret
          sequence, watched zones and anything waiting to send. Live location stops updating.
        </p>
        <HoldBar label="Hold to wipe this phone" onFire={wipe} />
        <p className="text-sm text-soft">
          Your evidence stays safe on the server, and your recovery code and PIN bring it back. This is not forensic erasure: a web app can’t scrub the
          phone’s storage, backups, browser history, or files you exported.
        </p>
      </Card>

      <Card aria-labelledby="erase-title">
        <CardTitle id="erase-title">Delete everything from the server</CardTitle>
        <p className="text-[15px] text-soft">Permanently deletes your evidence, location history, alerts, zones and contacts, and ends any live map. It can’t be undone, and the recovery code stops working.</p>
        <Button variant="secondary" className="mt-3" disabled={offline} onClick={() => setErasing(true)}>
          Delete my account…
        </Button>
        {offline && <p className="mt-2 text-sm text-soft">This needs a connection.</p>}
      </Card>

      <Notice>Silent Seal is a hackathon working model. It complements emergency services and cannot guarantee anyone’s safety.</Notice>

      {erasing && (
        <ConfirmDialog
          title="Delete everything?"
          confirmLabel="Delete everything"
          busyLabel="Deleting…"
          danger
          busy={busy === 'erase'}
          error={eraseError}
          onConfirm={() => void erase()}
          onCancel={() => {
            setErasing(false)
            setPin('')
            setEraseError('')
          }}
        >
          <p>Your evidence, contacts, zones, alerts and location history will be gone for good. Files you already exported are not affected.</p>
          <DigitsField label="Type your PIN to confirm" value={pin} onValue={setPin} data-autofocus />
        </ConfirmDialog>
      )}
    </div>
  )
}
