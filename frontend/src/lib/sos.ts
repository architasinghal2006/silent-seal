import { api, sessionToken } from './api'
import { readBattery, readLocationSilently } from './device'
import { enqueue, flushQueue, newClientId } from './queue'
import { currentOfflineToken } from './session'
import { startStream } from './stream'
import { captureSosAudio } from './vault'

async function sendContext(token: string | null, battery: number | null) {
  const reply = await api.sosContext(token, await readLocationSilently(), battery)
  if (reply.stream && reply.stream_token) startStream(reply.stream_token)
}

/**
 * Alert first, then follow with the location: GPS can take seconds or fail, and the alert
 * must not wait for it. The token is captured so this finishes after the app has locked.
 * Nothing here touches the screen. With no connection the alert waits in the queue instead.
 */
export function fireSos() {
  const token = sessionToken()
  const offlineToken = currentOfflineToken()
  const clientTs = new Date().toISOString()
  void (async () => {
    const battery = await readBattery()
    try {
      if (!token) throw new Error('offline session')
      await api.sos(token, clientTs, battery)
    } catch {
      if (!offlineToken) return
      const location = await readLocationSilently()
      await enqueue({
        path: '/offline/sos',
        token: offlineToken,
        body: { client_id: newClientId(), trigger: 'manual', client_ts: clientTs, battery, location },
      })
      void flushQueue()
      return
    }
    void captureSosAudio(token).catch(() => undefined)
    await sendContext(token, battery)
  })().catch(() => undefined)
}

/**
 * Runs after every unlock because the client cannot tell real from duress. The server keeps
 * the location only if an SOS is in progress, and tells the client whether to keep streaming.
 */
export function sendUnlockContext() {
  const token = sessionToken()
  void (async () => sendContext(token, await readBattery()))().catch(() => undefined)
}
