// Holds alerts and evidence until the phone is back online, then sends each exactly once.
//
// Every item has its own id. The server remembers ids it has handled, so sending an item
// again after a lost reply does nothing. An item is only removed here once the server has
// answered for it: until then nothing is reported as sent.
import { api, ApiError } from '../services/api'
import { startStream } from '../services/liveStream'
import type { QueueEventType, SyncEvent, SyncResult } from '../types/api'

// Named to blend in with a calculator.
const DB_NAME = 'calc-cache'
const DB_VERSION = 2
const STORE = 'q'
const LEGACY_STORE = 'h'
const TICK_MS = 15_000
const MAX_BATCH = 20
const BASE_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 5 * 60_000

/** pending: never tried. syncing: being sent now. failed: tried, and waiting to try again. */
export type SyncState = 'pending' | 'syncing' | 'failed'

export interface QueueItem {
  id: string
  type: QueueEventType
  /** When it happened on this phone, ISO 8601. */
  timestamp: string
  payload: Record<string, unknown>
  /** The offline token it must be sent with. */
  token: string
  status: SyncState
  attempts: number
  lastAttemptAt: number | null
  nextAttemptAt: number
}

export interface QueueSummary {
  waiting: number
  retrying: number
  lastSyncedAt: number | null
}

/** Doubles from 5 seconds up to 5 minutes, so a dead connection isn't hammered. */
export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1))
}

const LEGACY_TYPES: Record<string, QueueEventType> = { '/offline/sos': 'sos', '/offline/unlocked': 'unlock', '/offline/clip': 'evidence' }

/** Carries over anything queued by the previous version of the app, which stored requests instead of events. */
function convertLegacy(old: { path?: string; token?: string; body?: Record<string, unknown> }): QueueItem | null {
  const type = old.path ? LEGACY_TYPES[old.path] : undefined
  if (!type || !old.token || !old.body) return null
  const { client_id, client_ts, ...payload } = old.body
  if (typeof client_id !== 'string') return null
  return {
    id: client_id,
    type,
    timestamp: typeof client_ts === 'string' ? client_ts : new Date().toISOString(),
    payload,
    token: old.token,
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: 0,
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(STORE) ? request.transaction!.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: 'id' })
      if (db.objectStoreNames.contains(LEGACY_STORE)) {
        const legacy = request.transaction!.objectStore(LEGACY_STORE).getAll()
        legacy.onsuccess = () => {
          for (const old of legacy.result) {
            const item = convertLegacy(old)
            if (item) store.put(item)
          }
          db.deleteObjectStore(LEGACY_STORE)
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export function newEventId() {
  return crypto.randomUUID().replaceAll('-', '')
}

// ---------- change notification, for the sync indicator ----------

const listeners = new Set<() => void>()
let lastSyncedAt: number | null = null

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function changed() {
  listeners.forEach((listener) => listener())
}

// ---------- reading and writing ----------

export async function enqueue(event: { type: QueueEventType; payload: Record<string, unknown>; token: string; id?: string; timestamp?: string }): Promise<string> {
  const item: QueueItem = {
    id: event.id ?? newEventId(),
    type: event.type,
    timestamp: event.timestamp ?? new Date().toISOString(),
    payload: event.payload,
    token: event.token,
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: 0,
  }
  await withStore('readwrite', (store) => store.put(item))
  changed()
  return item.id
}

/** Everything still waiting, oldest first. */
export async function listQueue(): Promise<QueueItem[]> {
  const items = await withStore<QueueItem[]>('readonly', (store) => store.getAll())
  return items.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export async function queueSummary(): Promise<QueueSummary> {
  const items = await listQueue().catch(() => [] as QueueItem[])
  return { waiting: items.length, retrying: items.filter((i) => i.attempts > 0).length, lastSyncedAt }
}

async function update(items: QueueItem[]) {
  for (const item of items) await withStore('readwrite', (store) => store.put(item))
}

async function remove(ids: string[]) {
  for (const id of ids) await withStore('readwrite', (store) => store.delete(id))
}

// ---------- sending ----------

/** Same token, in order, and evidence on its own: one photo can be several megabytes. */
function batches(items: QueueItem[]): QueueItem[][] {
  const groups: QueueItem[][] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    const fits = last && last[0].token === item.token && last.length < MAX_BATCH && item.type !== 'evidence' && last[0].type !== 'evidence'
    if (fits) last.push(item)
    else groups.push([item])
  }
  return groups
}

const toEvent = (item: QueueItem): SyncEvent => ({ id: item.id, type: item.type, timestamp: item.timestamp, payload: item.payload })

let flushing = false

/**
 * Sends what is due. `force` ignores the retry timers, for when the connection has just come back.
 * Stops at the first connection problem, and only ever removes what the server answered for.
 */
export async function flushQueue({ force = false } = {}): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const now = Date.now()
    const due = (await listQueue()).filter((item) => force || item.nextAttemptAt <= now)
    for (const batch of batches(due)) {
      await update(batch.map((item) => ({ ...item, status: 'syncing' as const })))
      changed()
      try {
        const reply = await api.syncOffline(batch[0].token, batch.map(toEvent))
        // applied, duplicate and rejected are all final answers: none of them should be sent again.
        const answered = new Set(reply.results.map((r: SyncResult) => r.id))
        await remove(batch.filter((item) => answered.has(item.id)).map((item) => item.id))
        lastSyncedAt = Date.now()
        if (reply.stream && reply.stream_token) startStream(reply.stream_token)
        changed()
      } catch (e) {
        // A refusal of the whole request will never succeed (an erased account, say). Too-many-requests will.
        const permanent = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429
        if (permanent) {
          await remove(batch.map((item) => item.id))
          changed()
          continue
        }
        const tried = Date.now()
        await update(
          batch.map((item) => ({
            ...item,
            status: 'failed' as const,
            attempts: item.attempts + 1,
            lastAttemptAt: tried,
            nextAttemptAt: tried + backoffMs(item.attempts + 1),
          })),
        )
        changed()
        return
      }
    }
  } catch {
    /* Storage blocked: nothing can be queued anyway. */
  } finally {
    flushing = false
  }
}

let started = false

export function startQueue() {
  if (started) return
  started = true
  window.addEventListener('online', () => void flushQueue({ force: true }))
  setInterval(() => void flushQueue(), TICK_MS)
  void flushQueue({ force: true })
}

export function deleteQueue(): Promise<void> {
  lastSyncedAt = null
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = request.onerror = request.onblocked = () => {
      changed()
      resolve()
    }
  })
}
