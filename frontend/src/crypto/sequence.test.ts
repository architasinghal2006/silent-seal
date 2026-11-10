import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasOwnSequence, matchesSequence, saveSequence, sequenceProblem } from './sequence'

// Storage reads go through localStorage, which Node doesn't have.
const memory = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
})

beforeEach(() => memory.clear())

describe('secret sequence', () => {
  it('is the built-in default until the survivor chooses one', async () => {
    expect(hasOwnSequence()).toBe(false)
    expect(await matchesSequence('1379')).toBe(true)
    expect(await matchesSequence('1380')).toBe(false)
  })

  it('replaces the default once chosen', async () => {
    await saveSequence('40728')
    expect(hasOwnSequence()).toBe(true)
    expect(await matchesSequence('40728')).toBe(true)
    expect(await matchesSequence('1379')).toBe(false)
    expect(await matchesSequence('4072')).toBe(false)
  })

  it('is stored as a salted hash, never as the digits', async () => {
    await saveSequence('40728')
    const first = memory.get('calc.prefs')!
    expect(first).not.toContain('40728')
    await saveSequence('40728')
    // A fresh salt each time, so two phones with the same sequence store different values.
    expect(memory.get('calc.prefs')).not.toBe(first)
  })

  it('never matches anything that is not 4 to 8 digits', async () => {
    for (const typed of ['', '137', '123456789', '13.79', '13+79', 'Error']) expect(await matchesSequence(typed)).toBe(false)
  })

  it('refuses sequences that are invalid, accidental or equal to a PIN', async () => {
    expect(sequenceProblem('123')).toMatch(/4 to 8 digits/)
    expect(sequenceProblem('12a4')).toMatch(/4 to 8 digits/)
    expect(sequenceProblem('7777')).toMatch(/repeated digit/)
    expect(sequenceProblem('2468', ['2468', '1357'])).toMatch(/different from your PINs/)
    expect(sequenceProblem('2580', ['2468', '1357'])).toBe('')
    await expect(saveSequence('12')).rejects.toThrow()
  })
})
