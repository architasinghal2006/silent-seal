// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../services/api'
import type { SyncEvent } from '../types/api'

const syncOffline = vi.fn()
const startStream = vi.fn()
vi.mock('../services/api', async (original) => ({ ...(await original<typeof import('../services/api')>()), api: { syncOffline: (...args: unknown[]) => syncOffline(...args) } }))
vi.mock('../services/liveStream', () => ({ startStream: (...args: unknown[]) => startStream(...args) }))

const { backoffMs, deleteQueue, enqueue, flushQueue, listQueue, queueSummary, subscribeQueue } = await import('./queue')

/** Answers like the server: every event applied, unless told otherwise. */
function serverSays(status: 'applied' | 'duplicate' | 'rejected' = 'applied', extra = {}) {
  syncOffline.mockImplementation(async (_token: string, events: SyncEvent[]) => ({ results: events.map((e) => ({ id: e.id, status })), stream: false, stream_token: null, ...extra }))
}

beforeEach(async () => {
  await deleteQueue()
  syncOffline.mockReset()
  startStream.mockReset()
})

describe('queue items', () => {
  it('carry an id, type, timestamp, payload, sync status and retry metadata', async () => {
    const id = await enqueue({ type: 'sos', token: 't', payload: { trigger: 'manual' }, timestamp: '2026-11-10T10:00:00.000Z' })
    const [item] = await listQueue()
    expect(item).toEqual({
      id,
      type: 'sos',
      timestamp: '2026-11-10T10:00:00.000Z',
      payload: { trigger: 'manual' },
      token: 't',
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      nextAttemptAt: 0,
    })
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('are listed oldest first', async () => {
    await enqueue({ type: 'sos', token: 't', payload: {}, timestamp: '2026-11-10T10:05:00.000Z' })
    await enqueue({ type: 'unlock', token: 't', payload: {}, timestamp: '2026-11-10T10:01:00.000Z' })
    expect((await listQueue()).map((i) => i.type)).toEqual(['unlock', 'sos'])
  })
})

describe('syncing', () => {
  it('removes an item only after the server answers for it', async () => {
    serverSays('applied')
    await enqueue({ type: 'sos', token: 'tok', payload: { battery: 0.4 }, id: 'a'.repeat(32), timestamp: '2026-11-10T10:00:00.000Z' })

    await flushQueue()

    expect(syncOffline).toHaveBeenCalledWith('tok', [{ id: 'a'.repeat(32), type: 'sos', timestamp: '2026-11-10T10:00:00.000Z', payload: { battery: 0.4 } }])
    expect(await listQueue()).toEqual([])
    expect((await queueSummary()).lastSyncedAt).not.toBeNull()
  })

  it.each(['duplicate', 'rejected'] as const)('treats "%s" as a final answer and does not send again', async (status) => {
    serverSays(status)
    await enqueue({ type: 'sos', token: 't', payload: {} })
    await flushQueue()
    await flushQueue({ force: true })
    expect(syncOffline).toHaveBeenCalledTimes(1)
    expect(await listQueue()).toEqual([])
  })

  it('keeps the item and backs off when the connection fails', async () => {
    syncOffline.mockRejectedValue(new TypeError('Failed to fetch'))
    await enqueue({ type: 'sos', token: 't', payload: {} })
    const before = Date.now()

    await flushQueue()

    const [item] = await listQueue()
    expect(item.status).toBe('failed')
    expect(item.attempts).toBe(1)
    expect(item.nextAttemptAt).toBeGreaterThanOrEqual(before + backoffMs(1))
    expect((await queueSummary()).retrying).toBe(1)
  })

  it('waits for the retry time, unless the connection has just come back', async () => {
    syncOffline.mockRejectedValue(new TypeError('Failed to fetch'))
    await enqueue({ type: 'sos', token: 't', payload: {} })
    await flushQueue()
    await flushQueue()
    expect(syncOffline).toHaveBeenCalledTimes(1)

    serverSays('applied')
    await flushQueue({ force: true })
    expect(await listQueue()).toEqual([])
  })

  it('sends the same id again after a lost reply, so the server can recognise it', async () => {
    syncOffline.mockRejectedValueOnce(new TypeError('reply lost'))
    const id = await enqueue({ type: 'sos', token: 't', payload: {} })
    await flushQueue()
    serverSays('duplicate')
    await flushQueue({ force: true })

    const sentIds = syncOffline.mock.calls.map(([, events]) => (events as SyncEvent[])[0].id)
    expect(sentIds).toEqual([id, id])
    expect(await listQueue()).toEqual([])
  })

  it('retries after a server error or a rate limit, but drops what will never be accepted', async () => {
    await enqueue({ type: 'sos', token: 't', payload: {} })
    syncOffline.mockRejectedValueOnce(new ApiError(503, 'down'))
    await flushQueue()
    syncOffline.mockRejectedValueOnce(new ApiError(429, 'slow down'))
    await flushQueue({ force: true })
    expect((await listQueue())[0].attempts).toBe(2)

    // 401: the account was erased, so its token will never work again.
    syncOffline.mockRejectedValueOnce(new ApiError(401, 'unauthorized'))
    await flushQueue({ force: true })
    expect(await listQueue()).toEqual([])
  })

  it('stops at the first connection problem, leaving later items untouched', async () => {
    await enqueue({ type: 'evidence', token: 't', payload: { ciphertext: 'YQ==' }, timestamp: '2026-11-10T10:00:00.000Z' })
    await enqueue({ type: 'sos', token: 't', payload: {}, timestamp: '2026-11-10T10:01:00.000Z' })
    syncOffline.mockRejectedValue(new TypeError('offline'))

    await flushQueue()

    expect(syncOffline).toHaveBeenCalledTimes(1)
    expect((await listQueue()).map((i) => i.attempts)).toEqual([1, 0])
  })

  it('groups by token and sends evidence on its own', async () => {
    serverSays('applied')
    await enqueue({ type: 'unlock', token: 'A', payload: {}, timestamp: '2026-11-10T10:00:00.000Z' })
    await enqueue({ type: 'sos', token: 'A', payload: {}, timestamp: '2026-11-10T10:01:00.000Z' })
    await enqueue({ type: 'evidence', token: 'A', payload: {}, timestamp: '2026-11-10T10:02:00.000Z' })
    await enqueue({ type: 'sos', token: 'B', payload: {}, timestamp: '2026-11-10T10:03:00.000Z' })

    await flushQueue()

    expect(syncOffline.mock.calls.map(([token, events]) => [token, (events as SyncEvent[]).map((e) => e.type)])).toEqual([
      ['A', ['unlock', 'sos']],
      ['A', ['evidence']],
      ['B', ['sos']],
    ])
  })

  it('starts streaming location when the server says an alert is now live', async () => {
    serverSays('applied', { stream: true, stream_token: 'stream-1' })
    await enqueue({ type: 'sos', token: 't', payload: {} })
    await flushQueue()
    expect(startStream).toHaveBeenCalledWith('stream-1')
  })

  it('tells listeners when the queue changes', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeQueue(listener)
    await enqueue({ type: 'sos', token: 't', payload: {} })
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    listener.mockClear()
    await enqueue({ type: 'sos', token: 't', payload: {} })
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('backoff', () => {
  it('doubles from 5 seconds and is capped at 5 minutes', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000])
    expect(backoffMs(20)).toBe(300_000)
  })
})
