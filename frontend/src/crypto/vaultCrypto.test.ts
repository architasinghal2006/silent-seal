import { describe, expect, it } from 'vitest'
import {
  createVault,
  entryHash,
  findChainBreak,
  fromBase64,
  GENESIS_HASH,
  openClip,
  openEntry,
  openVault,
  sealClip,
  sealEntry,
  toBase64,
  type Envelope,
  type SealedEntry,
} from './vaultCrypto'

const ITERATIONS = 1000 // Tests only: the real default is 600,000.
const PASSPHRASE = 'correct horse battery'

const note = (text: string): Envelope => ({
  v: 1,
  type: 'text',
  text,
  capturedAt: '2026-11-03T10:00:00.000Z',
  location: { lat: 28.6, lng: 77.2, accuracy: 10 },
})

async function chain(key: CryptoKey, count: number) {
  const entries: SealedEntry[] = []
  let previous = GENESIS_HASH
  for (let seq = 1; seq <= count; seq++) {
    const entry = await sealEntry(key, note(`note ${seq}`), seq, previous)
    entries.push(entry)
    previous = entry.entry_hash
  }
  return entries
}

function flip(text: string) {
  const bytes = fromBase64(text)
  bytes[0] ^= 1
  return toBase64(bytes)
}

describe('base64', () => {
  it('round-trips large binary data', () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 256)
    expect(fromBase64(toBase64(big))).toEqual(big)
  })
})

describe('vault keys', () => {
  it('opens with the right passphrase and refuses a wrong one', async () => {
    const { meta } = await createVault(PASSPHRASE, ITERATIONS)
    expect(await openVault(PASSPHRASE, meta)).not.toBeNull()
    expect(await openVault('not the passphrase', meta)).toBeNull()
  })

  it('never puts the passphrase or plaintext in what the server stores', async () => {
    const { meta, keys } = await createVault(PASSPHRASE, ITERATIONS)
    const sealed = await sealEntry(keys.key, note('private words'), 1, GENESIS_HASH)
    const stored = JSON.stringify({ meta, sealed })
    expect(stored).not.toContain(PASSPHRASE)
    expect(stored).not.toContain('private words')
    expect(stored).not.toContain(btoa('private words'))
    expect(meta.iterations).toBe(ITERATIONS)
  })

  it('keeps keys non-extractable', async () => {
    const { keys } = await createVault(PASSPHRASE, ITERATIONS)
    expect(keys.key.extractable).toBe(false)
    expect(keys.privateKey.extractable).toBe(false)
  })

  it('defaults to a strong iteration count', async () => {
    const { PBKDF2_ITERATIONS } = await import('./vaultCrypto')
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000)
  })
})

describe('entries', () => {
  it('round-trips through a reopened vault', async () => {
    const { meta, keys } = await createVault(PASSPHRASE, ITERATIONS)
    const sealed = await sealEntry(keys.key, note('hello'), 1, GENESIS_HASH)
    const reopened = await openVault(PASSPHRASE, meta)
    expect(await openEntry(reopened!.key, sealed)).toEqual(note('hello'))
  })

  it('uses a fresh IV every time', async () => {
    const { keys } = await createVault(PASSPHRASE, ITERATIONS)
    const a = await sealEntry(keys.key, note('same'), 1, GENESIS_HASH)
    const b = await sealEntry(keys.key, note('same'), 1, GENESIS_HASH)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('refuses to open altered ciphertext', async () => {
    const { keys } = await createVault(PASSPHRASE, ITERATIONS)
    const sealed = await sealEntry(keys.key, note('hello'), 1, GENESIS_HASH)
    await expect(openEntry(keys.key, { ...sealed, ciphertext: flip(sealed.ciphertext) })).rejects.toThrow()
  })

  it('refuses to open an entry moved to another position', async () => {
    const { keys } = await createVault(PASSPHRASE, ITERATIONS)
    const sealed = await sealEntry(keys.key, note('hello'), 1, GENESIS_HASH)
    await expect(openEntry(keys.key, { ...sealed, seq: 2 })).rejects.toThrow()
    await expect(openEntry(keys.key, { ...sealed, prev_hash: 'a'.repeat(64) })).rejects.toThrow()
  })
})

describe('hash chain', () => {
  it('accepts an intact chain', async () => {
    const { keys } = await createVault(PASSPHRASE, ITERATIONS)
    expect(await findChainBreak(await chain(keys.key, 4))).toBeNull()
    expect(await findChainBreak([])).toBeNull()
  })

  it('names the first entry after edits, removals and swaps', async () => {
    const { keys } = await createVault(PASSPHRASE, ITERATIONS)
    const entries = await chain(keys.key, 4)

    const edited = entries.map((e) => ({ ...e }))
    edited[1].ciphertext = flip(edited[1].ciphertext)
    expect(await findChainBreak(edited)).toBe(2)

    expect(await findChainBreak([entries[0], entries[2], entries[3]])).toBe(2)
    expect(await findChainBreak([entries[1], entries[0], entries[2]])).toBe(1)
  })

  it('catches a forger who recomputes every hash when the entry is opened', async () => {
    const { keys } = await createVault(PASSPHRASE, ITERATIONS)
    const [first, second] = await chain(keys.key, 2)
    const ciphertext = flip(second.ciphertext)
    const forged = {
      ...second,
      ciphertext,
      entry_hash: await entryHash(second.seq, second.prev_hash, second.iv, ciphertext),
    }
    expect(await findChainBreak([first, forged])).toBeNull()
    await expect(openEntry(keys.key, forged)).rejects.toThrow()
  })
})

describe('sos clips', () => {
  const clip: Envelope = {
    v: 1,
    type: 'audio',
    mime: 'audio/webm',
    data: btoa('sound'),
    capturedAt: '2026-11-03T10:00:00.000Z',
    location: null,
    source: 'sos',
  }

  it('can be sealed with only the public key and opened with the passphrase', async () => {
    const { meta } = await createVault(PASSPHRASE, ITERATIONS)
    const sealed = await sealClip(meta.public_key, clip)
    expect(JSON.stringify(sealed)).not.toContain(clip.data)
    const reopened = await openVault(PASSPHRASE, meta)
    expect(await openClip(reopened!.privateKey, sealed)).toEqual(clip)
  })

  it('refuses a different vault and altered data', async () => {
    const { meta, keys } = await createVault(PASSPHRASE, ITERATIONS)
    const other = await createVault('another long passphrase', ITERATIONS)
    const sealed = await sealClip(meta.public_key, clip)
    await expect(openClip(other.keys.privateKey, sealed)).rejects.toThrow()
    await expect(openClip(keys.privateKey, { ...sealed, ciphertext: flip(sealed.ciphertext) })).rejects.toThrow()
  })
})
