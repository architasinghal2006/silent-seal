import { readBattery, readLocationSilently } from '../geolocation/device'
import { enqueue, flushQueue } from '../offline/queue'
import { api, holdSession, sessionToken } from './api'
import { startStream } from './liveStream'
import { currentOfflineToken } from './session'
import { captureSosAudio } from './vault'

/**
 * How far an alert got, as far as this phone knows.
 * sent: the server accepted it. queued: saved on this phone, waiting for a connection.
 * failed: could not be sent or saved.
 */
export type SosOutcome = { state: 'sent'; eventId: string } | { state: 'queued'; queueId: string } | { state: 'failed' }

async function sendContext(token: string | null, battery: number | null) {
  const reply = await api.sosContext(token, await readLocationSilently(), battery)
  if (reply.stream && reply.stream_token) startStream(reply.stream_token)
}

/**
 * Alert first, then follow with the location: GPS can take seconds or fail, and the alert
 * must not wait for it. The token is captured so this finishes after the app has locked.
 * Nothing here touches the screen. With no connection the alert waits in the queue instead.
 *
 * The promise resolves as soon as the alert itself is accepted or queued. It never rejects.
 */
export function fireSos(): Promise<SosOutcome> {
  const token = sessionToken()
  const offlineToken = currentOfflineToken()
  const clientTs = new Date().toISOString()

  // Held from this moment, so locking the app right away cannot end the session under the alert.
  return holdSession((async (): Promise<SosOutcome> => {
    const battery = await readBattery()
    try {
      if (!token) throw new Error('offline session')
      const accepted = await api.sos(token, clientTs, battery)
      // The rest carries on after the caller has its answer, and keeps the session alive until it is done.
      void holdSession(Promise.allSettled([captureSosAudio(token), sendContext(token, battery)]))
      return { state: 'sent', eventId: accepted.event_id }
    } catch {
      if (!offlineToken) return { state: 'failed' }
      const location = await readLocationSilently()
      const queueId = await enqueue({
        type: 'sos',
        token: offlineToken,
        timestamp: clientTs,
        payload: { trigger: 'manual', battery, location },
      })
      void flushQueue({ force: true })
      return { state: 'queued', queueId }
    }
  })().catch((): SosOutcome => ({ state: 'failed' })))
}

/**
 * Runs after every unlock because the client cannot tell real from duress. The server keeps
 * the location only if an SOS is in progress, and tells the client whether to keep streaming.
 */
export function sendUnlockContext() {
  const token = sessionToken()
  // Held, so an immediate quick exit cannot stop the location reaching an SOS already under way.
  void holdSession((async () => sendContext(token, await readBattery()))().catch(() => undefined))
}
