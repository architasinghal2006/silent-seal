import { stopWatcher } from '../geolocation/watcher'
import { deleteQueue } from '../offline/queue'
import { endSession } from './api'
import { stopStream } from './liveStream'
import { clearLocalSession } from './session'
import { resetThrottle } from './unlockThrottle'
import { lockVault } from './vault'

/**
 * Locks the app: drops the session token, the vault keys and anything decrypted, all of
 * which only ever lived in memory, and ends the session on the server.
 *
 * Live location sharing, the geofence watcher and the sync queue are left running: they work
 * with their own narrow tokens and must carry on while the phone shows a calculator.
 */
export function lockSession() {
  endSession()
  lockVault()
  clearLocalSession()
}

/**
 * Panic wipe. Clears everything this app holds on the phone: the account link, offline PIN
 * records, the secret sequence, watched zones, the live-location token and anything waiting
 * to sync. The cached app files stay, so the calculator still works and looks like a fresh install.
 *
 * This is not forensic erasure. A web app cannot scrub the device's storage, backups, browser
 * history or exported files. Nothing on the server is deleted: evidence stays safe there.
 *
 * Memory goes first, so it's gone even if clearing storage fails.
 */
export async function wipeDevice() {
  lockSession()
  stopStream()
  stopWatcher()
  resetThrottle()
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    /* Storage blocked, so there is nothing stored. */
  }
  await deleteQueue()
}
