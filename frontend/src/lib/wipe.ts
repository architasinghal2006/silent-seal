import { clearToken } from './api'
import { deleteQueue } from './queue'
import { clearLocalSession } from './session'
import { stopStream } from './stream'
import { lockVault } from './vault'
import { stopWatcher } from './watcher'

/**
 * Clears everything this app holds on the phone. The cached app files stay, so the calculator
 * still works and looks like a fresh install. Memory goes first so it's gone even if storage fails.
 */
export async function wipeDevice() {
  clearToken()
  lockVault()
  clearLocalSession()
  stopStream()
  stopWatcher()
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    /* Storage blocked, so there is nothing stored. */
  }
  await deleteQueue()
}
