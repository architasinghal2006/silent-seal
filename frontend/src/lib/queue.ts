import { api, ApiError, type StreamReply } from './api'
import { startStream } from './stream'

// Holds alerts and evidence until the phone is back online. Named to blend in with a calculator.
const DB_NAME = 'calc-cache'
const STORE = 'h'
const RETRY_MS = 15_000

export interface QueueItem {
  path: string
  token: string
  body: Record<string, unknown>
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { autoIncrement: true })
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
    })
  } finally {
    db.close()
  }
}

export function newClientId() {
  return crypto.randomUUID().replaceAll('-', '')
}

export async function enqueue(item: QueueItem) {
  await withStore('readwrite', (store) => store.add(item))
}

export function queuedCount() {
  return withStore('readonly', (store) => store.count())
}

let flushing = false

/** Sends in order. Stops at the first connection problem, and only ever removes what was answered. */
export async function flushQueue() {
  if (flushing) return
  flushing = true
  try {
    const keys = await withStore('readonly', (store) => store.getAllKeys())
    for (const key of keys) {
      const item = await withStore<QueueItem | undefined>('readonly', (store) => store.get(key))
      if (!item) continue
      try {
        const reply = await api.sendQueued<StreamReply>(item.path, item.body, item.token)
        if (reply?.stream && reply.stream_token) startStream(reply.stream_token)
      } catch (e) {
        // A 4xx will never succeed (an erased account, say). Anything else is worth retrying.
        const permanent = e instanceof ApiError && e.status >= 400 && e.status < 500
        if (!permanent) return
      }
      await withStore('readwrite', (store) => store.delete(key))
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
  window.addEventListener('online', () => void flushQueue())
  setInterval(() => void flushQueue(), RETRY_MS)
  void flushQueue()
}

export function deleteQueue(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}
