export const PHONE_PATTERN = /^\+?\d{7,15}$/
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const MIN_PASSPHRASE = 10

/** Why a vault passphrase can't be used, in words for the person choosing it, or '' if it can. */
export function passphraseProblem(passphrase: string, confirm: string): string {
  if (passphrase.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`
  // PINs are all digits, so this also guarantees it can't be the same as a PIN.
  if (/^\d+$/.test(passphrase)) return 'Use some letters or words, not only numbers.'
  if (passphrase !== confirm) return "Those don't match. Type the same passphrase twice."
  return ''
}
