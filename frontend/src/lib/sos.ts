import { api, sessionToken } from './api'
import { readBattery, readLocationSilently } from './device'
import { startStream } from './stream'

async function sendContext(token: string | null, battery: number | null) {
  const reply = await api.sosContext(token, await readLocationSilently(), battery)
  if (reply.stream && reply.stream_token) startStream(reply.stream_token)
}

/**
 * Alert first, then follow with the location: GPS can take seconds or fail, and the alert
 * must not wait for it. The token is captured so this finishes after the app has locked.
 * Nothing here touches the screen. Offline retry arrives with the queue in Phase E.
 */
export function fireSos() {
  const token = sessionToken()
  const clientTs = new Date().toISOString()
  void (async () => {
    const battery = await readBattery()
    await api.sos(token, clientTs, battery)
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
