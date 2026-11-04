// Lets a PIN work with no connection, without the phone learning which PIN it was.
//
// Each PIN seals a record holding an opaque token. Two records of the same size sit in random
// order, so storage shows nothing about which is which. Whichever opens, the phone reports it
// the same way, and the server decides from the token whether that was a duress unlock.
//
// A short PIN can be brute-forced by someone who copies this storage. These records can only
// send alerts and hold a public key, but that attacker would learn the PIN itself.
import { fromBase64, PBKDF2_ITERATIONS, seal, toBase64, unseal, deriveKey } from './crypto'
import { getRecords, setRecords, type LocalRecord } from './storage'

const PADDED_LENGTH = 2400

export interface LocalPayload {
  t: string // offline token
  pk: string | null // vault public key, for sealing evidence offline
}

export interface OpenedRecord {
  index: number
  key: CryptoKey
  salt: string
  iterations: number
  payload: LocalPayload
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function seed(payload: LocalPayload, key: CryptoKey, salt: string, iterations: number): Promise<LocalRecord> {
  const plain = JSON.stringify(payload).padEnd(PADDED_LENGTH, ' ')
  const { iv, ciphertext } = await seal(key, encoder.encode(plain))
  return { salt, iterations, iv, ct: ciphertext }
}

async function makeRecord(pin: string, payload: LocalPayload, iterations: number): Promise<LocalRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(pin, salt, iterations)
  return seed(payload, key, toBase64(salt), iterations)
}

/** At setup both PINs are known, so both records exist from the start, in random order. */
export async function createRecords(
  realPin: string,
  realToken: string,
  duressPin: string,
  duressToken: string,
  iterations = PBKDF2_ITERATIONS,
) {
  const records = await Promise.all([
    makeRecord(realPin, { t: realToken, pk: null }, iterations),
    makeRecord(duressPin, { t: duressToken, pk: null }, iterations),
  ])
  if (crypto.getRandomValues(new Uint8Array(1))[0] & 1) records.reverse()
  setRecords(records)
}

/** Returns null when the PIN opens nothing, which offline means a wrong PIN. */
export async function openRecord(pin: string): Promise<OpenedRecord | null> {
  const records = getRecords()
  let found: OpenedRecord | null = null
  // Always tries every record, so the time taken doesn't reveal which one matched.
  for (let index = 0; index < records.length; index++) {
    const { salt, iterations, iv, ct } = records[index]
    const key = await deriveKey(pin, fromBase64(salt), iterations)
    try {
      const payload = JSON.parse(decoder.decode(await unseal(key, iv, ct)).trimEnd()) as LocalPayload
      found = { index, key, salt, iterations, payload }
    } catch {
      /* Not this record. */
    }
  }
  return found
}

export async function addRecord(pin: string, payload: LocalPayload, iterations = PBKDF2_ITERATIONS) {
  setRecords([...getRecords(), await makeRecord(pin, payload, iterations)])
}

export async function updateRecord(opened: OpenedRecord, payload: LocalPayload) {
  const records = getRecords()
  records[opened.index] = await seed(payload, opened.key, opened.salt, opened.iterations)
  setRecords(records)
}
