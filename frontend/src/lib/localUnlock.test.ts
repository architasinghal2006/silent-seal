import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addRecord, createRecords, openRecord, updateRecord } from './localUnlock'
import { getRecords, setRecords } from './storage'

// Storage reads go through localStorage, which Node doesn't have.
const memory = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
})

const ITERATIONS = 1000

describe('offline PIN records', () => {
  beforeEach(() => {
    memory.clear()
  })

  it('opens the matching record for each PIN and nothing for a wrong one', async () => {
    await createRecords('2468', 'real-token', '1357', 'duress-token', ITERATIONS)
    expect((await openRecord('2468'))?.payload.t).toBe('real-token')
    expect((await openRecord('1357'))?.payload.t).toBe('duress-token')
    expect(await openRecord('0000')).toBeNull()
  })

  it('keeps leading zeros significant', async () => {
    await createRecords('0123', 'real-token', '1357', 'duress-token', ITERATIONS)
    expect(await openRecord('123')).toBeNull()
    expect((await openRecord('0123'))?.payload.t).toBe('real-token')
  })

  it('makes the records look alike, even when only one holds a public key', async () => {
    await createRecords('2468', 'x'.repeat(200), '1357', 'y'.repeat(200), ITERATIONS)
    const opened = await openRecord('2468')
    await updateRecord(opened!, { ...opened!.payload, pk: 'k'.repeat(500) })
    const [a, b] = getRecords()
    expect(a.ct.length).toBe(b.ct.length)
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    expect(JSON.stringify(getRecords())).not.toMatch(/duress|real|x{10}|y{10}|k{10}/)
  })

  it('places them in random order', async () => {
    const orders = new Set<boolean>()
    for (let n = 0; n < 24; n++) {
      await createRecords('2468', 'real-token', '1357', 'duress-token', ITERATIONS)
      orders.add((await openRecord('2468'))!.index === 0)
    }
    expect(orders.size).toBe(2)
  })

  it('updates a record so it still opens with the same PIN', async () => {
    await createRecords('2468', 'real-token', '1357', 'duress-token', ITERATIONS)
    const opened = await openRecord('2468')
    await updateRecord(opened!, { t: 'real-token', pk: 'public' })
    expect((await openRecord('2468'))?.payload.pk).toBe('public')
    expect((await openRecord('1357'))?.payload.pk).toBeNull()
  })

  it('adds a record for a device restored with a recovery code', async () => {
    setRecords([])
    await addRecord('2468', { t: 'restored', pk: null }, ITERATIONS)
    expect((await openRecord('2468'))?.payload.t).toBe('restored')
  })
})
