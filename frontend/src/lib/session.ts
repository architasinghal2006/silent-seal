import { api, sessionToken } from './api'
import { addRecord, openRecord, updateRecord, type OpenedRecord } from './localUnlock'
import { enqueue, flushQueue, newClientId } from './queue'
import { readBattery, readLocationSilently } from './device'
import { getRecords } from './storage'
import { updateWatch } from './watcher'

// Offline token and vault public key for the unlocked session. In memory only.
let offlineToken: string | null = null
let publicKey: string | null = null
let record: OpenedRecord | null = null

export const currentOfflineToken = () => offlineToken
export const currentPublicKey = () => publicKey

export function clearLocalSession() {
  offlineToken = null
  publicKey = null
  record = null
}

/** A vault created this session should work offline straight away, without unlocking again first. */
export async function rememberPublicKey(key: string) {
  publicKey = key
  if (record) await updateRecord(record, { ...record.payload, pk: key })
}

/** With no connection: true if the PIN opened a record. Reported the same way for either PIN. */
export async function unlockOffline(pin: string): Promise<boolean> {
  const opened = await openRecord(pin).catch(() => null)
  if (!opened) return false
  offlineToken = opened.payload.t
  publicKey = opened.payload.pk

  const token = opened.payload.t
  void (async () => {
    const [battery, location] = await Promise.all([readBattery(), readLocationSilently()])
    await enqueue({
      path: '/offline/unlocked',
      token,
      body: { client_id: newClientId(), client_ts: new Date().toISOString(), battery, location },
    })
    void flushQueue()
  })().catch(() => undefined)
  return true
}

/**
 * After an online unlock: refresh what this phone needs for next time it's offline. Runs for
 * either PIN, so a duress session does the same work. Failures just mean older data is kept.
 */
export async function syncAfterUnlock(pin: string) {
  const token = sessionToken()
  await api.zones(token).then((z) => updateWatch(z.watch, z.watch_token)).catch(() => undefined)

  const meta = await api.vaultMeta(token).catch(() => null)
  const key = meta?.configured ? meta.public_key : null

  const opened = await openRecord(pin)
  if (opened) {
    record = opened
    offlineToken = opened.payload.t
    publicKey = key ?? opened.payload.pk
    if (key && key !== opened.payload.pk) await updateRecord(opened, { ...opened.payload, pk: key })
    return
  }
  // A phone restored with a recovery code has a record only for PINs used on it so far.
  if (getRecords().length < 2) {
    const reply = await api.offlineToken(token)
    offlineToken = reply.token
    publicKey = key
    await addRecord(pin, { t: reply.token, pk: key })
  }
}
