import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { QuickExit } from '../components/QuickExit'
import { api } from '../lib/api'
import { createVault, fromBase64, openVault, type Envelope, type VaultMeta } from '../lib/crypto'
import { readLocationSilently } from '../lib/device'
import { pauseHideLock, resumeHideLock } from '../lib/guard'
import { requestMicrophone, startRecording, stopStream, type ActiveRecorder } from '../lib/recorder'
import { currentPublicKey, rememberPublicKey } from '../lib/session'
import { getSosAudio, setSosAudio } from '../lib/storage'
import {
  blobToBase64,
  buildBundle,
  collectSosClips,
  currentVault,
  loadEntries,
  queueEvidence,
  saveEvidence,
  setVault,
  type OpenedVault,
  type VaultSession,
} from '../lib/vault'

const MIN_PASSPHRASE = 10
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_RECORDING_MS = 60_000

const TYPE_LABEL = { text: 'Note', photo: 'Photo', audio: 'Audio' }

const QUEUED_MESSAGE = "You're offline, so this is encrypted and waiting on this phone. It joins your vault when you're back online."

function passphraseProblem(passphrase: string, confirm: string) {
  if (passphrase.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`
  // PINs are all digits, so this also guarantees it can't be the same as a PIN.
  if (/^\d+$/.test(passphrase)) return 'Use some letters or words, not only numbers.'
  if (passphrase !== confirm) return "Those don't match. Type the same passphrase twice."
  return ''
}

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
    <form className="card form" onSubmit={submit}>
      <h2>Create a vault passphrase</h2>
      <p className="muted">
        Your notes, photos and audio are locked with this before they leave your phone. Nobody else can open
        them, including us. It is separate from your PIN. If you forget it, your evidence can't be recovered.
      </p>
      <label>
        Passphrase
        <input
          className="input-text"
          type="password"
          autoComplete="off"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
        <small className="muted">A few words you'll remember works well. At least {MIN_PASSPHRASE} characters.</small>
      </label>
      <label>
        Type it again
        <input
          className="input-text"
          type="password"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create vault'}
      </button>
    </form>
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
    setError("That passphrase doesn't match.")
    setBusy(false)
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Open your vault</h2>
      <label>
        Passphrase
        <input
          className="input-text"
          type="password"
          autoComplete="off"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Opening…' : 'Open vault'}
      </button>
    </form>
  )
}

function EntryCard({ seq, envelope }: { seq: number; envelope: Envelope | null }) {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!envelope?.data) return
    const objectUrl = URL.createObjectURL(new Blob([fromBase64(envelope.data)], { type: envelope.mime }))
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [envelope])

  if (!envelope) {
    return (
      <li className="card entry">
        <strong>Entry {seq}</strong>
        <p className="error">This entry can't be opened. It may have been changed.</p>
      </li>
    )
  }

  const { location } = envelope
  return (
    <li className="card entry">
      <strong>
        {envelope.source === 'sos' ? 'Audio from an alert' : TYPE_LABEL[envelope.type]}, entry {seq}
      </strong>
      <span className="muted">
        {new Date(envelope.capturedAt).toLocaleString()}
        {location
          ? `, at ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}${
              location.accuracy !== null ? ` (within ${Math.round(location.accuracy)} m)` : ''
            }`
          : ', no location'}
      </span>
      {envelope.type === 'photo' && url && <img src={url} alt={`Evidence photo, entry ${seq}`} />}
      {envelope.type === 'audio' && url && <audio controls src={url} />}
      {envelope.text && <p className="entry-text">{envelope.text}</p>}
    </li>
  )
}

function OpenVault({ vault }: { vault: VaultSession }) {
  const [opened, setOpened] = useState<OpenedVault | null>(null)
  const [note, setNote] = useState('')
  const [writing, setWriting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [sosAudio, setSosAudioState] = useState(getSosAudio)
  const recorder = useRef<ActiveRecorder | null>(null)
  const recordingStart = useRef('')
  const recordingLocation = useRef<ReturnType<typeof readLocationSilently>>()
  const autoStop = useRef<ReturnType<typeof setTimeout>>()
  const fileInput = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    setOpened(await loadEntries(vault))
  }, [vault])

  useEffect(() => {
    void (async () => {
      const failed = await collectSosClips(vault).catch(() => 0)
      if (failed) setError(`${failed} audio ${failed === 1 ? 'clip' : 'clips'} from an alert could not be added. They will be tried again.`)
      await refresh().catch(() => setError('Could not load your vault. Check your connection.'))
    })()
  }, [vault, refresh])

  /** Finishes a recording and seals it. Uses only captured values, so it also works after quick exit. */
  const finishRecording = useCallback(async () => {
    const active = recorder.current
    if (!active) return
    recorder.current = null
    clearTimeout(autoStop.current)
    const { blob, mime } = await active.stop()
    return saveEvidence(vault, {
      v: 1,
      type: 'audio',
      mime,
      data: await blobToBase64(blob),
      capturedAt: recordingStart.current,
      location: (await recordingLocation.current) ?? null,
    })
  }, [vault])

  // Leaving mid-recording (quick exit, screen off) keeps the evidence instead of losing it.
  useEffect(() => () => void finishRecording().catch(() => undefined), [finishRecording])

  async function save(envelope: Omit<Envelope, 'v' | 'capturedAt' | 'location'>, capturedAt = new Date().toISOString()) {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const location = await readLocationSilently()
      const outcome = await saveEvidence(vault, { v: 1, capturedAt, location, ...envelope })
      if (outcome === 'queued') setInfo(QUEUED_MESSAGE)
      else await refresh()
      return true
    } catch {
      setError('Could not save that. Check your connection and try again. Nothing was saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault()
    if (!note.trim()) return setError('Write something first.')
    if (await save({ type: 'text', text: note.trim() })) {
      setNote('')
      setWriting(false)
    }
  }

  function choosePhoto() {
    pauseHideLock()
    fileInput.current?.click()
  }

  async function onPhoto(file: File | undefined) {
    resumeHideLock()
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) return setError('That photo is over 8 MB, so it was not saved. Try a smaller one.')
    await save({ type: 'photo', mime: file.type || 'image/jpeg', data: await blobToBase64(file) })
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
      setRecording(true)
      autoStop.current = setTimeout(() => void stopAudio(), MAX_RECORDING_MS)
    } catch {
      setError("Couldn't use the microphone. Check that it's allowed in your browser's site settings.")
    }
  }

  async function stopAudio() {
    setRecording(false)
    setBusy(true)
    try {
      const outcome = await finishRecording()
      if (outcome === 'queued') setInfo(QUEUED_MESSAGE)
      else await refresh()
    } catch {
      setError('Could not save that recording. Check your connection.')
    } finally {
      setBusy(false)
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
      setError("Couldn't use the microphone, so this stays off. Check that it's allowed in your browser's site settings.")
    }
  }

  function exportBundle() {
    if (!opened) return
    const name = `calc-history-${new Date().toISOString().slice(0, 10)}.json`
    const url = URL.createObjectURL(new Blob([buildBundle(vault, opened.sealed)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    setInfo(
      `Saved ${name} to your Downloads. It stays encrypted, but someone could notice the file, so move it somewhere safe and delete it from this phone.`,
    )
  }

  const count = opened?.entries.length ?? 0

  return (
    <>
      <section className="card" role="status">
        {!opened && <p className="muted">Opening your entries…</p>}
        {opened && opened.brokenAt === null && (
          <p className="ok">
            {count === 0
              ? 'Your vault is empty.'
              : `Integrity check passed: ${count} ${count === 1 ? 'entry' : 'entries'}, none changed or out of order.`}
          </p>
        )}
        {opened && opened.brokenAt !== null && (
          <p className="error">
            Integrity check failed at entry {opened.brokenAt}. Stored evidence may have been changed. Export a copy
            and tell someone you trust.
          </p>
        )}
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      {info && <p className="muted" role="status">{info}</p>}

      {writing ? (
        <form className="card form" onSubmit={saveNote}>
          <label>
            What happened
            <textarea className="input-text" rows={5} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="contact-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Encrypting…' : 'Save note'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setWriting(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : recording ? (
        <section className="card">
          <p>Recording. It stops by itself after 1 minute, and leaving this screen saves it.</p>
          <button type="button" className="btn btn-primary" onClick={() => void stopAudio()}>
            Stop and save
          </button>
        </section>
      ) : (
        <div className="vault-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setWriting(true)}>
            Add note
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={choosePhoto}>
            Add photo
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void startAudio()}>
            Record audio
          </button>
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

      <p className="muted">Each entry saves your location and the time. Entries can't be edited or removed one by one, which keeps the record trustworthy.</p>

      {opened && count > 0 && (
        <>
          <ul className="entry-list">
            {[...opened.entries].reverse().map((entry) => (
              <EntryCard key={entry.seq} seq={entry.seq} envelope={entry.envelope} />
            ))}
          </ul>
          <button type="button" className="btn btn-secondary" onClick={exportBundle}>
            Export encrypted copy
          </button>
        </>
      )}

      <section className="card form">
        <label className="check">
          <input type="checkbox" checked={sosAudio} onChange={(e) => void toggleSosAudio(e.target.checked)} />
          <span>Also record 10 seconds of audio when I send an alert</span>
        </label>
        <p className="muted">
          It's encrypted and added here the next time you open your vault. Your phone may show a small microphone
          dot while it records, which someone could notice. Nothing is recorded or kept when you use your duress PIN.
        </p>
      </section>
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
      setInfo(QUEUED_MESSAGE)
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
      setError("Couldn't use the microphone. Check that it's allowed in your browser's site settings.")
    }
  }

  return (
    <>
      <p className="muted">
        You're offline, so your existing entries can't be shown. New evidence is encrypted now and joins your vault when
        you're back online.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {info && <p className="ok" role="status">{info}</p>}
      <form className="card form" onSubmit={saveNote}>
        <label>
          What happened
          <textarea className="input-text" rows={5} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Encrypting…' : 'Save note'}
        </button>
      </form>
      <div className="vault-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => {
            pauseHideLock()
            fileInput.current?.click()
          }}
        >
          Add photo
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void toggleRecording()}>
          {recording ? 'Stop and save' : 'Record audio'}
        </button>
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

export function Vault({ offline, onBack, onExit }: { offline: boolean; onBack: () => void; onExit: () => void }) {
  const [meta, setMeta] = useState<(VaultMeta & { configured: true }) | { configured: false } | null>(null)
  const [vault, setOpenVault] = useState(currentVault)
  const [error, setError] = useState('')

  useEffect(() => {
    if (vault || offline) return
    api.vaultMeta().then(setMeta).catch(() => setError('Could not reach your vault. Check your connection.'))
  }, [vault, offline])

  const offlineKey = currentPublicKey()

  return (
    <main className="screen">
      <QuickExit onExit={onExit} />
      <button type="button" className="link-back" onClick={onBack}>
        Back
      </button>
      <h1>Evidence vault</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {offline ? (
        offlineKey ? (
          <OfflineCapture publicKey={offlineKey} />
        ) : (
          <p className="muted">You don't have a vault on this phone yet. Setting one up needs a connection.</p>
        )
      ) : vault ? (
        <OpenVault vault={vault} />
      ) : meta === null ? null : meta.configured ? (
        <UnlockVault meta={meta} onOpen={setOpenVault} />
      ) : (
        <CreateVault onOpen={setOpenVault} />
      )}
    </main>
  )
}
