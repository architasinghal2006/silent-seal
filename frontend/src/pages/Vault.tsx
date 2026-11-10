import { Camera, Download, FileText, FolderLock, Lock, Mic, ShieldCheck, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { Card, CardTitle, PageHeader } from '../components/ui/Card'
import { Switch, TextArea, TextField } from '../components/ui/Field'
import { Loading } from '../components/ui/Spinner'
import { EmptyState, ErrorState, Notice } from '../components/ui/States'
import { StatusChip } from '../components/ui/StatusChip'
import { useSession } from '../contexts/SessionContext'
import { useToast } from '../contexts/ToastContext'
import { createVault, fromBase64, openVault, type Envelope, type VaultMeta } from '../crypto/vaultCrypto'
import { readLocationSilently } from '../geolocation/device'
import { api, holdSession, type VaultMetaReply } from '../services/api'
import { requestMicrophone, startRecording, stopStream, type ActiveRecorder } from '../services/recorder'
import { currentPublicKey, rememberPublicKey } from '../services/session'
import {
  blobToBase64,
  collectSosClips,
  currentVault,
  loadEntries,
  lockVault,
  queueEvidence,
  saveEvidence,
  setVault,
  shortId,
  type OpenedEntry,
  type OpenedVault,
  type VaultSession,
} from '../services/vault'
import type { VerifyResult } from '../types/api'
import { formatDateTime, parseServerTime, plural } from '../utils/format'
import { pauseHideLock, resumeHideLock } from '../utils/guard'
import { getSosAudio, setSosAudio } from '../utils/storage'
import { passphraseProblem } from '../utils/validation'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_RECORDING_MS = 60_000
const QUEUED = 'You’re offline, so this is encrypted and waiting on this phone. It joins your vault when you’re back online.'

const TYPES = {
  text: { label: 'Note', icon: FileText },
  photo: { label: 'Photo', icon: Camera },
  audio: { label: 'Audio', icon: Mic },
}

const SAMPLE_NOTES = [
  'Sample entry for demonstration. He took my phone and read my messages again this evening, then shouted for about twenty minutes. The neighbours may have heard.',
  'Sample entry for demonstration. Called the 181 helpline from a friend’s phone. They explained what a protection order is and where the nearest One Stop Centre is.',
]

function CreateVault({ onOpen }: { onOpen: (vault: VaultSession) => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = passphraseProblem(passphrase, confirm)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      const { meta, keys } = await createVault(passphrase)
      await api.createVaultMeta(meta)
      void rememberPublicKey(meta.public_key).catch(() => undefined)
      onOpen(setVault(keys, meta))
    } catch {
      setError('Could not set up the vault. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <Card as="form" onSubmit={submit} className="grid gap-4">
      <div>
        <h2 className="text-[17px] font-semibold">Create a vault passphrase</h2>
        <p className="mt-1 text-[15px] text-soft">
          Your notes, photos and audio are encrypted with this on your phone before they are stored. It is separate from your PIN, and it never
          leaves this phone.
        </p>
      </div>
      <TextField label="Passphrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} hint="A few words you’ll remember works well. At least 10 characters, not only numbers." />
      <TextField label="Type it again" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Notice tone="warn">Nobody can reset this, including us. If you forget it, your evidence can’t be opened.</Notice>
      <Button type="submit" loading={busy}>
        {busy ? 'Creating your vault…' : 'Create vault'}
      </Button>
    </Card>
  )
}

function UnlockVault({ meta, onOpen }: { meta: VaultMeta; onOpen: (vault: VaultSession) => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const keys = await openVault(passphrase, meta).catch(() => null)
    if (keys) return onOpen(setVault(keys, meta))
    setError('That passphrase doesn’t match. Check it and try again.')
    setBusy(false)
  }

  return (
    <Card as="form" onSubmit={submit} className="grid gap-4">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-fill text-ink" aria-hidden="true">
          <Lock size={22} />
        </span>
        <div>
          <h2 className="text-[17px] font-semibold">Your vault is locked</h2>
          <p className="text-[15px] text-soft">Enter your passphrase to decrypt it on this phone.</p>
        </div>
      </div>
      <TextField label="Passphrase" type="password" value={passphrase} autoFocus onChange={(e) => setPassphrase(e.target.value)} error={error} />
      <Button type="submit" loading={busy}>
        {busy ? 'Opening…' : 'Unlock vault'}
      </Button>
    </Card>
  )
}

function EvidenceCard({ entry }: { entry: OpenedEntry }) {
  const { envelope } = entry
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string>()

  // Decrypted media exists only while its card is open, and is released when it closes.
  useEffect(() => {
    if (!open || !envelope?.data) return
    const objectUrl = URL.createObjectURL(new Blob([fromBase64(envelope.data)], { type: envelope.mime }))
    setUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
      setUrl(undefined)
    }
  }, [open, envelope])

  if (!envelope) {
    return (
      <Card as="li" className="p-4">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          Entry {entry.seq} <StatusChip tone="danger">Can’t be opened</StatusChip>
        </p>
        <p className="mt-1 text-sm text-danger-ink">This entry failed its check. It may have been changed after it was stored.</p>
      </Card>
    )
  }

  const type = TYPES[envelope.type]
  const Icon = type.icon
  const { location } = envelope
  return (
    <Card as="li" className="p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-mint-soft text-green-ink" aria-hidden="true">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {envelope.source === 'sos' ? 'Audio from an alert' : type.label}
            <span className="rounded-md bg-fill px-1.5 py-0.5 font-mono text-xs font-medium text-soft" title="Encrypted entry identifier">
              #{entry.seq} · {shortId(entry.id)}
            </span>
          </p>
          <p className="text-sm text-soft">
            {formatDateTime(new Date(envelope.capturedAt))}
            {location ? ` · ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : ' · no location'}
          </p>
        </div>
        <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'View'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 grid gap-2 border-t border-line pt-3">
          {envelope.type === 'photo' && url && <img src={url} alt={`Evidence photo, entry ${entry.seq}`} className="max-h-96 w-full rounded-control object-contain" />}
          {envelope.type === 'audio' && url && <audio controls src={url} className="w-full" />}
          {envelope.text && <p className="whitespace-pre-wrap break-words text-[15px]">{envelope.text}</p>}
          <p className="text-xs text-soft">
            Stored by the server {formatDateTime(parseServerTime(entry.storedAt))}. The time and place above come from this phone.
          </p>
        </div>
      )}
    </Card>
  )
}

function VerifyOutcome({ result }: { result: VerifyResult }) {
  return (
    <Notice tone={result.valid ? 'ok' : 'danger'} icon={<ShieldCheck size={18} />}>
      <strong className="block">
        {result.valid ? `Verified: ${plural(result.count, 'entry', 'entries')}, none altered, reordered or missing from the middle.` : `Verification failed: ${plural(result.problems.length, 'problem')} found.`}
      </strong>
      {!result.valid && (
        <span className="mt-1 block">
          {result.problems.map((p, i) => (
            <span key={i} className="block">
              {p.detail}
            </span>
          ))}
        </span>
      )}
      <span className="mt-1 block text-sm font-normal">{result.scope}</span>
    </Notice>
  )
}

function OpenVault({ vault, onLock }: { vault: VaultSession; onLock: () => void }) {
  const { demo } = useSession()
  const toast = useToast()
  const [opened, setOpened] = useState<OpenedVault | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [note, setNote] = useState('')
  const [writing, setWriting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [verdict, setVerdict] = useState<VerifyResult | null>(null)
  const [sosAudio, setSosAudioState] = useState(getSosAudio)
  const recorder = useRef<ActiveRecorder | null>(null)
  const recordingStart = useRef('')
  const recordingLocation = useRef<ReturnType<typeof readLocationSilently>>()
  const recordingSaved = useRef<() => void>()
  const autoStop = useRef<ReturnType<typeof setTimeout>>()
  const fileInput = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    setLoadFailed(false)
    try {
      setOpened(await loadEntries(vault))
    } catch {
      setLoadFailed(true)
    }
  }, [vault])

  useEffect(() => {
    void (async () => {
      const failed = await collectSosClips(vault).catch(() => 0)
      if (failed) setError(`${plural(failed, 'item')} saved while the vault was locked could not be added yet. They will be tried again next time.`)
      await refresh()
    })()
  }, [vault, refresh])

  /** Finishes a recording and seals it. Uses only captured values, so it also works after quick exit. */
  const finishRecording = useCallback(async () => {
    const active = recorder.current
    if (!active) return
    recorder.current = null
    clearTimeout(autoStop.current)
    try {
      const { blob, mime } = await active.stop()
      return await saveEvidence(vault, {
        v: 1,
        type: 'audio',
        mime,
        data: await blobToBase64(blob),
        capturedAt: recordingStart.current,
        location: (await recordingLocation.current) ?? null,
      })
    } finally {
      recordingSaved.current?.()
    }
  }, [vault])

  // Leaving mid-recording (quick exit, screen off) keeps the evidence instead of losing it.
  useEffect(() => () => void finishRecording().catch(() => undefined), [finishRecording])

  async function save(envelope: Omit<Envelope, 'v' | 'capturedAt' | 'location'>, doing: string) {
    setBusy(doing)
    setError('')
    setInfo('')
    setVerdict(null)
    try {
      const location = await readLocationSilently()
      const outcome = await saveEvidence(vault, { v: 1, capturedAt: new Date().toISOString(), location, ...envelope })
      if (outcome === 'queued') setInfo(QUEUED)
      else {
        await refresh()
        toast('Encrypted and saved')
      }
      return true
    } catch {
      setError('Could not save that, so nothing was stored. Check your connection and try again.')
      return false
    } finally {
      setBusy('')
    }
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault()
    if (!note.trim()) return setError('Write something first.')
    if (await save({ type: 'text', text: note.trim() }, 'note')) {
      setNote('')
      setWriting(false)
    }
  }

  function choosePhoto() {
    // Opening the camera or file picker hides the page, which would otherwise lock the app.
    pauseHideLock()
    fileInput.current?.click()
  }

  async function onPhoto(file: File | undefined) {
    resumeHideLock()
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) return setError('That photo is over 8 MB, so it was not saved. Try a smaller one.')
    await save({ type: 'photo', mime: file.type || 'image/jpeg', data: await blobToBase64(file) }, 'photo')
  }

  async function startAudio() {
    setError('')
    setInfo('')
    try {
      const stream = await requestMicrophone()
      try {
        recorder.current = startRecording(stream)
      } catch (e) {
        stopStream(stream)
        throw e
      }
      recordingStart.current = new Date().toISOString()
      recordingLocation.current = readLocationSilently()
      // Keeps the session open until this recording is saved, even if the app is locked first.
      void holdSession(new Promise<void>((resolve) => (recordingSaved.current = resolve)))
      setRecording(true)
      autoStop.current = setTimeout(() => void stopAudio(), MAX_RECORDING_MS)
    } catch {
      setError('Couldn’t use the microphone. Check that it’s allowed in your browser’s site settings.')
    }
  }

  async function stopAudio() {
    setRecording(false)
    setBusy('audio')
    try {
      const outcome = await finishRecording()
      if (outcome === 'queued') setInfo(QUEUED)
      else {
        await refresh()
        toast('Encrypted and saved')
      }
    } catch {
      setError('Could not save that recording. Check your connection.')
    } finally {
      setBusy('')
    }
  }

  async function toggleSosAudio(on: boolean) {
    setError('')
    if (!on) {
      setSosAudio(false)
      return setSosAudioState(false)
    }
    try {
      stopStream(await requestMicrophone())
      setSosAudio(true)
      setSosAudioState(true)
    } catch {
      setError('Couldn’t use the microphone, so this stays off. Check that it’s allowed in your browser’s site settings.')
    }
  }

  async function exportBundle() {
    setBusy('export')
    setError('')
    try {
      const bundle = await api.exportVault()
      const name = `calc-history-${new Date().toISOString().slice(0, 10)}.json`
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      setInfo(`Saved ${name} to your Downloads. It is still encrypted, but someone could notice the file: move it somewhere safe and delete it from this phone.`)
    } catch {
      setError('Could not export. Check your connection and try again.')
    } finally {
      setBusy('')
    }
  }

  async function verify() {
    setBusy('verify')
    setError('')
    try {
      setVerdict(await api.verifyBundle(await api.exportVault()))
    } catch {
      setError('Could not verify. Check your connection and try again.')
    } finally {
      setBusy('')
    }
  }

  async function addSamples() {
    for (const text of SAMPLE_NOTES) {
      if (!(await save({ type: 'text', text }, 'sample'))) return
    }
  }

  const count = opened?.entries.length ?? 0

  return (
    <>
      <Card tone={opened && opened.brokenAt !== null ? 'card' : 'mint'} role="status" className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-green-ink" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-green-deep">Unlocked · encrypted with AES-256-GCM</p>
          {!opened && !loadFailed && <p className="text-[15px] text-green-ink">Decrypting your entries on this phone…</p>}
          {opened && opened.brokenAt === null && (
            <p className="text-[15px] text-green-ink">{count === 0 ? 'No entries yet.' : `Integrity check passed: ${plural(count, 'entry', 'entries')}, none changed or out of order.`}</p>
          )}
          {opened && opened.brokenAt !== null && (
            <p className="text-[15px] font-medium text-danger-ink">
              Integrity check failed at entry {opened.brokenAt}. Stored evidence may have been changed. Export a copy and tell someone you trust.
            </p>
          )}
        </div>
        <Button variant="secondary" size="sm" className="bg-white" icon={<Lock size={15} aria-hidden="true" />} onClick={onLock}>
          Lock
        </Button>
      </Card>

      {loadFailed && <ErrorState onRetry={() => void refresh()}>Couldn’t load your vault.</ErrorState>}
      {error && <Notice tone="danger">{error}</Notice>}
      {info && <Notice tone="info">{info}</Notice>}

      {writing ? (
        <Card as="form" onSubmit={saveNote} className="grid gap-4">
          <TextArea label="What happened" rows={5} autoFocus value={note} onChange={(e) => setNote(e.target.value)} hint="Encrypted on this phone when you save. It can’t be edited afterwards." />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy === 'note'} className="flex-1">
              {busy === 'note' ? 'Encrypting…' : 'Save note'}
            </Button>
            <Button variant="secondary" disabled={Boolean(busy)} onClick={() => setWriting(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </Card>
      ) : recording ? (
        <Card className="grid gap-3">
          <p className="flex items-center gap-2 font-semibold">
            <span className="size-3 animate-pulse rounded-full bg-danger" aria-hidden="true" /> Recording
          </p>
          <p className="text-[15px] text-soft">It stops by itself after 1 minute. Leaving this screen saves what has been recorded.</p>
          <Button variant="dark" icon={<Square size={16} aria-hidden="true" />} onClick={() => void stopAudio()}>
            Stop and save
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Button variant="secondary" className="h-20 flex-col bg-card shadow-card" disabled={Boolean(busy)} onClick={() => setWriting(true)}>
            <FileText size={22} aria-hidden="true" /> Add note
          </Button>
          <Button variant="secondary" className="h-20 flex-col bg-card shadow-card" loading={busy === 'photo'} disabled={Boolean(busy)} onClick={choosePhoto}>
            {busy !== 'photo' && <Camera size={22} aria-hidden="true" />} Add photo
          </Button>
          <Button variant="secondary" className="h-20 flex-col bg-card shadow-card" loading={busy === 'audio'} disabled={Boolean(busy)} onClick={() => void startAudio()}>
            {busy !== 'audio' && <Mic size={22} aria-hidden="true" />} Record audio
          </Button>
          <input
            ref={(el) => {
              fileInput.current = el
              el?.addEventListener('cancel', resumeHideLock)
            }}
            type="file"
            accept="image/*"
            hidden
            aria-label="Photo file"
            onChange={(e) => void onPhoto(e.target.files?.[0])}
          />
        </div>
      )}

      {opened && count === 0 && (
        <EmptyState
          icon={<FolderLock size={28} />}
          title="Nothing in your vault yet"
          action={
            demo ? (
              <Button variant="secondary" loading={busy === 'sample'} onClick={() => void addSamples()}>
                Add two sample notes
              </Button>
            ) : undefined
          }
        >
          Add a note, photo or recording. Each one is saved with the time and your location, and linked to the one before it so changes can be detected.
        </EmptyState>
      )}

      {opened && count > 0 && (
        <>
          <ul className="grid gap-3">
            {[...opened.entries].reverse().map((entry) => (
              <EvidenceCard key={entry.id} entry={entry} />
            ))}
          </ul>
          <Card className="grid gap-3">
            <CardTitle>Export and verify</CardTitle>
            <p className="-mt-2 text-[15px] text-soft">
              The export is an encrypted copy of every entry with its hash chain. Anyone can check it hasn’t been altered; only your passphrase opens it.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="secondary" loading={busy === 'export'} disabled={Boolean(busy)} icon={<Download size={17} aria-hidden="true" />} onClick={() => void exportBundle()}>
                Export encrypted copy
              </Button>
              <Button variant="secondary" loading={busy === 'verify'} disabled={Boolean(busy)} icon={<ShieldCheck size={17} aria-hidden="true" />} onClick={() => void verify()}>
                Verify hash chain
              </Button>
            </div>
            {verdict && <VerifyOutcome result={verdict} />}
          </Card>
        </>
      )}

      <Card>
        <Switch
          label="Record 10 seconds of audio with an alert"
          hint="Encrypted and added here the next time you open your vault. Your phone may show a small microphone dot while it records, which someone could notice."
          checked={sosAudio}
          onChange={(on) => void toggleSosAudio(on)}
        />
      </Card>
    </>
  )
}

/** With no connection the chain can't be read or extended, but new evidence can still be sealed and held. */
function OfflineCapture({ publicKey }: { publicKey: string }) {
  const [note, setNote] = useState('')
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const recorder = useRef<ActiveRecorder | null>(null)
  const recordingStart = useRef('')
  const fileInput = useRef<HTMLInputElement | null>(null)

  async function hold(envelope: Omit<Envelope, 'v' | 'location'>) {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await queueEvidence(publicKey, { v: 1, location: await readLocationSilently(), ...envelope })
      setInfo(QUEUED)
      return true
    } catch {
      setError('Could not save that on this phone.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault()
    if (!note.trim()) return setError('Write something first.')
    if (await hold({ type: 'text', text: note.trim(), capturedAt: new Date().toISOString() })) setNote('')
  }

  async function onPhoto(file: File | undefined) {
    resumeHideLock()
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) return setError('That photo is over 8 MB, so it was not saved. Try a smaller one.')
    await hold({ type: 'photo', mime: file.type || 'image/jpeg', data: await blobToBase64(file), capturedAt: new Date().toISOString() })
  }

  async function toggleRecording() {
    setError('')
    if (recorder.current) {
      const { blob, mime } = await recorder.current.stop()
      recorder.current = null
      setRecording(false)
      await hold({ type: 'audio', mime, data: await blobToBase64(blob), capturedAt: recordingStart.current })
      return
    }
    try {
      recorder.current = startRecording(await requestMicrophone())
      recordingStart.current = new Date().toISOString()
      setRecording(true)
    } catch {
      setError('Couldn’t use the microphone. Check that it’s allowed in your browser’s site settings.')
    }
  }

  return (
    <>
      <Notice tone="warn">You’re offline, so your stored entries can’t be shown. New evidence is encrypted now and joins your vault when you’re back online.</Notice>
      {error && <Notice tone="danger">{error}</Notice>}
      {info && <Notice tone="ok">{info}</Notice>}
      <Card as="form" onSubmit={saveNote} className="grid gap-4">
        <TextArea label="What happened" rows={5} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" loading={busy}>
          {busy ? 'Encrypting…' : 'Save note'}
        </Button>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="secondary"
          disabled={busy}
          icon={<Camera size={18} aria-hidden="true" />}
          onClick={() => {
            pauseHideLock()
            fileInput.current?.click()
          }}
        >
          Add photo
        </Button>
        <Button variant={recording ? 'dark' : 'secondary'} disabled={busy} icon={<Mic size={18} aria-hidden="true" />} onClick={() => void toggleRecording()}>
          {recording ? 'Stop and save' : 'Record audio'}
        </Button>
        <input
          ref={(el) => {
            fileInput.current = el
            el?.addEventListener('cancel', resumeHideLock)
          }}
          type="file"
          accept="image/*"
          hidden
          aria-label="Photo file"
          onChange={(e) => void onPhoto(e.target.files?.[0])}
        />
      </div>
    </>
  )
}

export function Vault() {
  const { offline } = useSession()
  const [meta, setMeta] = useState<VaultMetaReply | null>(null)
  const [vault, setOpenVault] = useState(currentVault)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (vault || offline) return
    setFailed(false)
    api.vaultMeta().then(setMeta).catch(() => setFailed(true))
  }, [vault, offline, attempt])

  function lock() {
    lockVault()
    setOpenVault(null)
  }

  const offlineKey = currentPublicKey()

  return (
    <div className="grid gap-4">
      <PageHeader title="Evidence vault" subtitle="Encrypted on this phone before it is stored. The server only ever holds ciphertext." />
      {offline ? (
        offlineKey ? (
          <OfflineCapture publicKey={offlineKey} />
        ) : (
          <Notice tone="warn">You don’t have a vault on this phone yet. Setting one up needs a connection.</Notice>
        )
      ) : vault ? (
        <OpenVault vault={vault} onLock={lock} />
      ) : failed ? (
        <ErrorState onRetry={() => setAttempt((n) => n + 1)}>Couldn’t reach your vault.</ErrorState>
      ) : meta === null ? (
        <Loading label="Checking your vault…" />
      ) : meta.configured ? (
        <UnlockVault meta={meta} onOpen={setOpenVault} />
      ) : (
        <CreateVault onOpen={setOpenVault} />
      )}
    </div>
  )
}
