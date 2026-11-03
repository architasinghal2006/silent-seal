// All vault encryption happens here, in the browser. The server only ever sees the output.
//
// Passphrase -> PBKDF2-SHA256 -> AES-256-GCM key, held in memory and never exported.
// Each entry's chain position is bound in as authenticated data, so the server cannot
// reorder entries or move them between positions even though it could recompute plain hashes.
//
// SOS audio is recorded while the vault is locked, so it is sealed to an RSA public key.
// The matching private key is stored encrypted under the passphrase key.

export const PBKDF2_ITERATIONS = 600_000
export const GENESIS_HASH = '0'.repeat(64)

const VERIFIER_TEXT = 'ssv1'
const VERIFIER_AAD = 'verifier'
const IV_BYTES = 12

export interface Envelope {
  v: 1
  type: 'text' | 'photo' | 'audio'
  text?: string
  mime?: string
  data?: string // base64
  capturedAt: string
  location: { lat: number; lng: number; accuracy: number | null } | null
  source?: 'sos'
}

export interface VaultMeta {
  salt: string
  iterations: number
  verifier_iv: string
  verifier_ct: string
  public_key: string
  private_iv: string
  private_ct: string
}

export interface SealedEntry {
  seq: number
  prev_hash: string
  iv: string
  ciphertext: string
  entry_hash: string
}

export interface SealedClip {
  iv: string
  ciphertext: string
  wrapped_key: string
}

export interface VaultKeys {
  key: CryptoKey
  privateKey: CryptoKey
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // In chunks: spreading a large array into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Chromium throws on `additionalData: undefined`, so the field must be left out when unused. */
function gcmParams(iv: Uint8Array, aad?: string): AesGcmParams {
  return aad === undefined ? { name: 'AES-GCM', iv } : { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }
}

async function seal(key: CryptoKey, plain: Uint8Array, aad?: string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(gcmParams(iv, aad), key, plain)
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
}

async function unseal(key: CryptoKey, iv: string, ciphertext: string, aad?: string): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(gcmParams(fromBase64(iv), aad), key, fromBase64(ciphertext))
  return new Uint8Array(plain)
}

export async function createVault(
  passphrase: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ meta: VaultMeta; keys: VaultKeys }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(passphrase, salt, iterations)
  const verifier = await seal(key, encoder.encode(VERIFIER_TEXT), VERIFIER_AAD)

  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const sealedPrivate = await seal(key, encoder.encode(JSON.stringify(privateJwk)))

  return {
    meta: {
      salt: toBase64(salt),
      iterations,
      verifier_iv: verifier.iv,
      verifier_ct: verifier.ciphertext,
      public_key: JSON.stringify(publicJwk),
      private_iv: sealedPrivate.iv,
      private_ct: sealedPrivate.ciphertext,
    },
    keys: { key, privateKey: await importPrivateKey(privateJwk) },
  }
}

function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
}

/** Returns null when the passphrase is wrong. */
export async function openVault(passphrase: string, meta: VaultMeta): Promise<VaultKeys | null> {
  const key = await deriveKey(passphrase, fromBase64(meta.salt), meta.iterations)
  try {
    await unseal(key, meta.verifier_iv, meta.verifier_ct, VERIFIER_AAD)
  } catch {
    return null
  }
  const privateJwk = JSON.parse(decoder.decode(await unseal(key, meta.private_iv, meta.private_ct)))
  return { key, privateKey: await importPrivateKey(privateJwk) }
}

export async function entryHash(seq: number, prevHash: string, iv: string, ciphertext: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${seq}|${prevHash}|${iv}|${ciphertext}`))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sealEntry(key: CryptoKey, envelope: Envelope, seq: number, prevHash: string): Promise<SealedEntry> {
  const { iv, ciphertext } = await seal(key, encoder.encode(JSON.stringify(envelope)), `${seq}|${prevHash}`)
  return { seq, prev_hash: prevHash, iv, ciphertext, entry_hash: await entryHash(seq, prevHash, iv, ciphertext) }
}

/** Throws if the entry was altered or moved. */
export async function openEntry(key: CryptoKey, entry: SealedEntry): Promise<Envelope> {
  const plain = await unseal(key, entry.iv, entry.ciphertext, `${entry.seq}|${entry.prev_hash}`)
  return JSON.parse(decoder.decode(plain)) as Envelope
}

/** The seq of the first entry that breaks the chain, or null if it is intact. */
export async function findChainBreak(entries: SealedEntry[]): Promise<number | null> {
  let previous = GENESIS_HASH
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.seq !== i + 1 || e.prev_hash !== previous) return i + 1
    if ((await entryHash(e.seq, e.prev_hash, e.iv, e.ciphertext)) !== e.entry_hash) return i + 1
    previous = e.entry_hash
  }
  return null
}

export async function sealClip(publicKeyJson: string, envelope: Envelope): Promise<SealedClip> {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(publicKeyJson),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
  const clipKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const { iv, ciphertext } = await seal(clipKey, encoder.encode(JSON.stringify(envelope)))
  const rawKey = await crypto.subtle.exportKey('raw', clipKey)
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey)
  return { iv, ciphertext, wrapped_key: toBase64(new Uint8Array(wrapped)) }
}

export async function openClip(privateKey: CryptoKey, clip: SealedClip): Promise<Envelope> {
  const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64(clip.wrapped_key))
  const clipKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
  return JSON.parse(decoder.decode(await unseal(clipKey, clip.iv, clip.ciphertext))) as Envelope
}
