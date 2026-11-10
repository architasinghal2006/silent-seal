// The secret sequence that turns the calculator into a PIN pad.
//
// It is kept as a salted hash so that someone reading this phone's storage does not simply
// see the digits. That is all it buys: a short numeric sequence can be guessed by trying every
// value, so the sequence is concealment, not protection. The PIN is the protection.
import { DEFAULT_SEQUENCE, SEQUENCE_PATTERN } from '../utils/config'
import { getSequenceHash, setSequenceHash } from '../utils/storage'
import { toBase64 } from './vaultCrypto'

const encoder = new TextEncoder()

async function digest(salt: string, sequence: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${sequence}`))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function isValidSequence(sequence: string): boolean {
  return SEQUENCE_PATTERN.test(sequence)
}

/** Why a sequence can't be used, in words for the person choosing it, or '' if it can. */
export function sequenceProblem(sequence: string, pins: string[] = []): string {
  if (!isValidSequence(sequence)) return 'Use 4 to 8 digits.'
  if (pins.includes(sequence)) return 'Choose something different from your PINs.'
  if (/^(\d)\1+$/.test(sequence)) return 'Avoid one repeated digit: it is easy to type by accident.'
  return ''
}

export async function saveSequence(sequence: string): Promise<void> {
  if (!isValidSequence(sequence)) throw new Error('invalid sequence')
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)))
  setSequenceHash({ s: salt, h: await digest(salt, sequence) })
}

export function hasOwnSequence(): boolean {
  return getSequenceHash() !== undefined
}

/** True if what was typed is this phone's sequence. Until one is chosen, that is the default. */
export async function matchesSequence(typed: string): Promise<boolean> {
  if (!isValidSequence(typed)) return false
  const stored = getSequenceHash()
  if (!stored) return typed === DEFAULT_SEQUENCE
  const candidate = await digest(stored.s, typed)
  // Compare every character, so the time taken says nothing about how close a guess was.
  let difference = candidate.length ^ stored.h.length
  for (let i = 0; i < candidate.length; i++) difference |= candidate.charCodeAt(i) ^ (stored.h.charCodeAt(i) || 0)
  return difference === 0
}
