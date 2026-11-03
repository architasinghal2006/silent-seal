import { api, ApiError, sessionToken } from './api'
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
} from './crypto'
import { readLocationSilently } from './device'
import { microphoneAllowed, requestMicrophone, startRecording } from './recorder'
import { getSosAudio } from './storage'

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
      return await api.appendVaultEntry(vault.token, sealed)
    } catch (e) {
      // Another save got there first: seal again against the new head.
      if (!(e instanceof ApiError && e.status === 409) || attempt >= APPEND_RETRIES) throw e
    }
  }
}

/** Moves audio captured during an SOS into the chain. Deleted from the holding area only once chained. */
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
  seq: number
  envelope: Envelope | null
}

export interface OpenedVault {
  entries: OpenedEntry[]
  sealed: SealedEntry[]
  /** Seq of the first entry that failed a check, or null if all passed. */
  brokenAt: number | null
}

export async function loadEntries(vault: VaultSession): Promise<OpenedVault> {
  const sealed = await api.vaultEntries()
  let brokenAt = await findChainBreak(sealed)
  const entries: OpenedEntry[] = []
  for (const entry of sealed) {
    try {
      entries.push({ seq: entry.seq, envelope: await openEntry(vault.keys.key, entry) })
    } catch {
      entries.push({ seq: entry.seq, envelope: null })
      brokenAt = brokenAt === null ? entry.seq : Math.min(brokenAt, entry.seq)
    }
  }
  return { entries, sealed, brokenAt }
}

export function buildBundle(vault: VaultSession, sealed: SealedEntry[]): string {
  const { meta } = vault
  return JSON.stringify({
    format: 'ssv1',
    exported_at: new Date().toISOString(),
    kdf: { name: 'PBKDF2-SHA256', salt: meta.salt, iterations: meta.iterations },
    verifier: { iv: meta.verifier_iv, ciphertext: meta.verifier_ct },
    entries: sealed,
    head_hash: sealed.length ? sealed[sealed.length - 1].entry_hash : '0'.repeat(64),
    count: sealed.length,
  })
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
