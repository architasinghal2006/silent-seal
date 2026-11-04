import type { WatchZone, ZoneState } from './geofence'

// Device-local state lives under a key that looks like ordinary calculator preferences.
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

interface Prefs {
  precision: number
  k?: string // account id
  s?: string // location stream token, so sharing resumes if the app is reopened
  a?: boolean // record audio with an SOS
  o?: LocalRecord[] // PIN-sealed records for unlocking with no connection
  g?: WatchData // zones the watcher follows
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

export function getAccountId(): string | undefined {
  return read().k
}

export function setAccountId(id: string) {
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
