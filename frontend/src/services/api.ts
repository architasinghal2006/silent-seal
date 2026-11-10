import type { SealedClip, SealedEntry, VaultMeta } from '../crypto/vaultCrypto'
import type {
  Contact,
  ContactInput,
  LiveShareStarted,
  LiveShareStatus,
  Location,
  Me,
  OfflineStatus,
  SosHistoryItem,
  SosStatus,
  StreamReply,
  SyncEvent,
  SyncReply,
  VerifyResult,
  ZoneInput,
  ZoneList,
} from '../types/api'

// The session token lives only in memory: closing, reloading or quick-exiting drops it.
let token: string | null = null

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown, authToken = token): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // Lets a small request finish after the page is hidden or closed. Large bodies aren't allowed to.
    keepalive: method === 'POST' && !path.startsWith('/vault') && !path.startsWith('/offline'),
  })
  if (!res.ok) throw new ApiError(res.status, `request failed: ${res.status}`)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function clearToken() {
  token = null
}

/** For work that must outlive the session, like an SOS that finishes after quick exit. */
export function sessionToken() {
  return token
}

// Work that was started before a lock and still needs its token: an alert on its way, a
// recording being saved. The server-side logout waits for it, so locking can't cut it off.
let holds = 0
let logoutWaiting: string | null = null

function logoutOnServer(authToken: string) {
  void request<void>('/auth/logout', 'POST', undefined, authToken).catch(() => undefined)
}

export function holdSession<T>(work: Promise<T>): Promise<T> {
  holds += 1
  return work.finally(() => {
    holds -= 1
    if (holds === 0 && logoutWaiting) {
      const waiting = logoutWaiting
      logoutWaiting = null
      logoutOnServer(waiting)
    }
  })
}

/**
 * Forgets the session token at once, and ends the session on the server as soon as nothing
 * in flight still depends on it.
 */
export function endSession() {
  const ending = token
  token = null
  if (!ending) return
  if (holds > 0) logoutWaiting = ending
  else logoutOnServer(ending)
}

export type UnlockResult = 'ok' | 'denied' | 'offline'

export type VaultMetaReply = (VaultMeta & { configured: true }) | { configured: false }

export interface StoredEvidence extends SealedEntry {
  id: string
  payload_hash: string
  created_at: string
}

export type EvidenceBundle = Record<string, unknown> & { count: number; entries: StoredEvidence[] }

export const api = {
  setup(realPin: string, duressPin: string) {
    return request<{ user_id: string; offline_real: string; offline_duress: string }>('/auth/setup', 'POST', {
      real_pin: realPin,
      duress_pin: duressPin,
    })
  },

  /** 'ok' for either PIN: real vs duress is invisible to the client. No connection is 'offline'. */
  async unlock(userId: string, pin: string): Promise<UnlockResult> {
    try {
      const res = await request<{ token: string }>('/auth/unlock', 'POST', { user_id: userId, pin })
      token = res.token
      return 'ok'
    } catch (e) {
      return e instanceof ApiError && e.status < 500 ? 'denied' : 'offline'
    }
  },

  me() {
    return request<Me>('/me')
  },

  contacts() {
    return request<Contact[]>('/contacts')
  },
  createContact(input: ContactInput) {
    return request<Contact>('/contacts', 'POST', input)
  },
  updateContact(id: string, input: ContactInput) {
    return request<Contact>(`/contacts/${id}`, 'PUT', input)
  },
  deleteContact(id: string) {
    return request<void>(`/contacts/${id}`, 'DELETE')
  },

  profile() {
    return request<{ alert_name: string }>('/profile')
  },
  saveProfile(alertName: string) {
    return request<{ alert_name: string }>('/profile', 'PUT', { alert_name: alertName })
  },

  sos(authToken: string | null, clientTs: string, battery: number | null) {
    return request<{ accepted: boolean; event_id: string }>('/sos', 'POST', { client_ts: clientTs, battery }, authToken)
  },
  sosContext(authToken: string | null, location: Location | null, battery: number | null) {
    return request<StreamReply>('/sos/context', 'POST', { location, battery }, authToken)
  },
  sosHistory() {
    return request<SosHistoryItem[]>('/sos/history')
  },
  sosStatus(eventId: string) {
    return request<SosStatus>(`/sos/${eventId}`)
  },

  liveShare() {
    return request<LiveShareStatus>('/live-share')
  },
  startLiveShare(location: Location | null, battery: number | null) {
    return request<LiveShareStarted>('/live-share', 'POST', { location, battery })
  },
  stopLiveShare() {
    return request<void>('/live-share/stop', 'POST')
  },
  liveLocation(streamToken: string, location: Location | null) {
    return request<StreamReply>('/live-share/location', 'POST', { location }, streamToken)
  },

  zones(authToken = token) {
    return request<ZoneList>('/zones', 'GET', undefined, authToken)
  },
  createZone(input: ZoneInput) {
    return request<ZoneList>('/zones', 'POST', input)
  },
  updateZone(id: string, input: ZoneInput) {
    return request<ZoneList>(`/zones/${id}`, 'PUT', input)
  },
  deleteZone(id: string) {
    return request<ZoneList>(`/zones/${id}`, 'DELETE')
  },

  vaultMeta(authToken = token) {
    return request<VaultMetaReply>('/vault/meta', 'GET', undefined, authToken)
  },
  createVaultMeta(meta: VaultMeta) {
    return request<{ configured: boolean }>('/vault/meta', 'PUT', meta)
  },
  vaultHead(authToken: string | null) {
    return request<{ seq: number; hash: string }>('/vault/head', 'GET', undefined, authToken)
  },
  evidence() {
    return request<StoredEvidence[]>('/vault/evidence')
  },
  appendEvidence(authToken: string | null, entry: SealedEntry) {
    return request<StoredEvidence>('/vault/evidence', 'POST', entry, authToken)
  },
  exportVault() {
    return request<EvidenceBundle>('/vault/export')
  },
  verifyBundle(bundle: unknown) {
    return request<VerifyResult>('/vault/verify', 'POST', { bundle })
  },
  vaultClips() {
    return request<(SealedClip & { id: string })[]>('/vault/clips')
  },
  addVaultClip(authToken: string | null, clip: SealedClip) {
    return request<{ accepted: boolean }>('/vault/clips', 'POST', clip, authToken)
  },
  deleteVaultClip(id: string) {
    return request<void>(`/vault/clips/${id}`, 'DELETE')
  },

  /** Sends queued events with the offline token they were queued under. Safe to send again. */
  syncOffline(offlineToken: string, events: SyncEvent[]) {
    return request<SyncReply>('/offline/sync', 'POST', { events }, offlineToken)
  },
  offlineStatus() {
    return request<OfflineStatus>('/offline/status')
  },
  offlineToken(authToken: string | null) {
    return request<{ token: string }>('/offline/token', 'GET', undefined, authToken)
  },

  eraseAccount(pin: string) {
    return request<void>('/account/erase', 'POST', { pin })
  },

  /** Demo servers only: fills this account with sample contacts, zones and history. */
  loadSampleData(centre: Location | null) {
    return request<void>('/demo/sample', 'POST', { centre })
  },
}
