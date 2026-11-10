import {
  findChainBreak,
  openClip,
  openEntry,
  sealClip,
  sealEntry,
  toBase64,
  type Envelope,
  type SealedEntry,
  type VaultKeys,
  type VaultMeta,
} from '../crypto/vaultCrypto'
import { readLocationSilently } from '../geolocation/device'
import { enqueue, flushQueue } from '../offline/queue'
import { getSosAudio } from '../utils/storage'
import { api, ApiError, sessionToken, type StoredEvidence } from './api'
import { microphoneAllowed, requestMicrophone, startRecording } from './recorder'
import { currentOfflineToken } from './session'

export const SOS_AUDIO_MS = 10_000
const APPEND_RETRIES = 5

/** Captured by whoever is saving, so a recording in progress still saves after quick exit. */
export interface VaultSession {
  keys: VaultKeys
  token: string | null
  meta: VaultMeta
}

// The only place the keys live, in memory. Locking the app drops them.
let session: VaultSession | null = null

export function currentVault() {
  return session
}

export function setVault(keys: VaultKeys, meta: VaultMeta) {
  session = { keys, meta, token: sessionToken() }
  return session
}

export function lockVault() {
  session = null
}

export async function blobToBase64(blob: Blob) {
  return toBase64(new Uint8Array(await blob.arrayBuffer()))
}

export async function appendEntry(vault: VaultSession, envelope: Envelope) {
  for (let attempt = 0; ; attempt++) {
    const head = await api.vaultHead(vault.token)
    const sealed = await sealEntry(vault.keys.key, envelope, head.seq + 1, head.hash)
    try {
      return await api.appendEvidence(vault.token, sealed)
    } catch (e) {
      // Another save got there first: seal again against the new head.
      if (!(e instanceof ApiError && e.status === 409) || attempt >= APPEND_RETRIES) throw e
    }
  }
}

/** Seals evidence with only the public key and queues it. It joins the chain next time the vault opens. */
export async function queueEvidence(publicKey: string, envelope: Envelope) {
  const token = currentOfflineToken()
  if (!token) throw new Error('no offline token')
  const clip = await sealClip(publicKey, envelope)
  // Only ciphertext is ever written to the queue or sent from it.
  await enqueue({ type: 'evidence', token, timestamp: envelope.capturedAt, payload: { ...clip } })
  void flushQueue({ force: true })
}

/** Saves to the chain, or if the connection has gone, holds it on the phone instead of losing it. */
export async function saveEvidence(vault: VaultSession, envelope: Envelope): Promise<'saved' | 'queued'> {
  try {
    await appendEntry(vault, envelope)
    return 'saved'
  } catch (e) {
    if (e instanceof ApiError && e.status < 500) throw e
    await queueEvidence(vault.meta.public_key, envelope)
    return 'queued'
  }
}

/** Moves evidence that was sealed while the vault was locked into the chain. Removed from the holding area only once chained. */
export async function collectSosClips(vault: VaultSession): Promise<number> {
  const clips = await api.vaultClips()
  let failed = 0
  for (const clip of clips) {
    try {
      await appendEntry(vault, await openClip(vault.keys.privateKey, clip))
      await api.deleteVaultClip(clip.id)
    } catch {
      failed++
    }
  }
  return failed
}

export interface OpenedEntry {
  id: string
  seq: number
  /** When the server stored it. The only timestamp not taken from this phone. */
  storedAt: string
  envelope: Envelope | null
}

export interface OpenedVault {
  entries: OpenedEntry[]
  sealed: SealedEntry[]
  /** Seq of the first entry that failed a check, or null if all passed. */
  brokenAt: number | null
}

export async function loadEntries(vault: VaultSession): Promise<OpenedVault> {
  const sealed: StoredEvidence[] = await api.evidence()
  let brokenAt = await findChainBreak(sealed)
  const entries: OpenedEntry[] = []
  for (const entry of sealed) {
    const base = { id: entry.id, seq: entry.seq, storedAt: entry.created_at }
    try {
      entries.push({ ...base, envelope: await openEntry(vault.keys.key, entry) })
    } catch {
      entries.push({ ...base, envelope: null })
      brokenAt = brokenAt === null ? entry.seq : Math.min(brokenAt, entry.seq)
    }
  }
  return { entries, sealed, brokenAt }
}

/** A short label for an entry: the start of its id. Says nothing about what is inside. */
export function shortId(id: string) {
  return id.slice(0, 8).toUpperCase()
}

/**
 * Records audio alongside an SOS, if the survivor turned this on. Sealed to the public key
 * because the vault is usually locked. Never prompts, and does nothing without a vault.
 */
export async function captureSosAudio(token: string | null) {
  if (!getSosAudio() || !(await microphoneAllowed())) return
  const meta = await api.vaultMeta(token)
  if (!meta.configured) return

  const capturedAt = new Date().toISOString()
  const recorder = startRecording(await requestMicrophone())
  const location = readLocationSilently()
  await new Promise((resolve) => setTimeout(resolve, SOS_AUDIO_MS))
  const { blob, mime } = await recorder.stop()

  const envelope: Envelope = {
    v: 1,
    type: 'audio',
    mime,
    data: await blobToBase64(blob),
    capturedAt,
    location: await location,
    source: 'sos',
  }
  await api.addVaultClip(token, await sealClip(meta.public_key, envelope))
}
