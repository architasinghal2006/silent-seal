import type { ZoneState } from '../geolocation/geofence'
import type { WatchZone } from '../types/api'

// Device-local state lives under a key that looks like ordinary calculator preferences.
// Nothing here is a credential on its own: no PIN, no session token, no passphrase, no evidence.
const KEY = 'calc.prefs'

export interface LocalRecord {
  salt: string
  iterations: number
  iv: string
  ct: string
}

export interface WatchData {
  zones: WatchZone[]
  token: string
  states: Record<string, ZoneState>
}

export interface SequenceHash {
  s: string // salt
  h: string // SHA-256 of salt and sequence
}

interface Prefs {
  precision: number
  k?: string // user id, which is also the recovery code
  s?: string // location stream token, so sharing resumes if the app is reopened
  a?: boolean // record audio with an SOS
  o?: LocalRecord[] // PIN-sealed records for unlocking with no connection
  g?: WatchData // zones the watcher follows
  q?: SequenceHash // the survivor's own secret sequence, hashed
  v?: boolean // stay on the status screen after sending an alert
}

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { precision: 12, ...JSON.parse(raw) }
  } catch {
    /* storage blocked or corrupt: behave as a fresh install */
  }
  return { precision: 12 }
}

function write(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

export function getUserId(): string | undefined {
  return read().k
}

export function setUserId(id: string) {
  write({ ...read(), k: id })
}

export function getStreamToken(): string | undefined {
  return read().s
}

export function setStreamToken(token: string | undefined) {
  write({ ...read(), s: token })
}

export function getSosAudio(): boolean {
  return read().a === true
}

export function setSosAudio(on: boolean) {
  write({ ...read(), a: on || undefined })
}

export function getRecords(): LocalRecord[] {
  return read().o ?? []
}

export function setRecords(records: LocalRecord[]) {
  write({ ...read(), o: records })
}

export function getWatch(): WatchData | undefined {
  return read().g
}

export function setWatch(data: WatchData | undefined) {
  write({ ...read(), g: data })
}

export function getSequenceHash(): SequenceHash | undefined {
  return read().q
}

export function setSequenceHash(hash: SequenceHash | undefined) {
  write({ ...read(), q: hash })
}

/** Off by default: after an alert the app returns to the calculator and shows nothing. */
export function getStayOnStatus(): boolean {
  return read().v === true
}

export function setStayOnStatus(on: boolean) {
  write({ ...read(), v: on || undefined })
}
