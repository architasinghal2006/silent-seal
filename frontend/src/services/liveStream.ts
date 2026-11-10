import { STREAM_INTERVAL_MS } from '../utils/config'
import { api, ApiError } from './api'
import { readLocationSilently } from '../geolocation/device'
import { getStreamToken, setStreamToken } from '../utils/storage'

// Module state on purpose: streaming carries on through quick exit, on the calculator.
let token: string | undefined
let timer: ReturnType<typeof setTimeout> | undefined

async function tick() {
  timer = undefined
  if (!token) return
  try {
    const reply = await api.liveLocation(token, await readLocationSilently())
    if (!reply.stream) return stopStream()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return stopStream()
    // Offline or a server blip: keep trying, the share may still be live.
  }
  if (token) timer = setTimeout(tick, STREAM_INTERVAL_MS)
}

export function startStream(streamToken: string) {
  token = streamToken
  setStreamToken(streamToken)
  if (timer === undefined) timer = setTimeout(tick, STREAM_INTERVAL_MS)
}

export function stopStream() {
  clearTimeout(timer)
  timer = undefined
  token = undefined
  setStreamToken(undefined)
}

/** Picks an interrupted share back up when the app reopens, with no PIN and nothing on screen. */
export function resumeStream() {
  const saved = getStreamToken()
  if (saved) startStream(saved)
}
