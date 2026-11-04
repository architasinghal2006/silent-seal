import type { SealedClip, SealedEntry, VaultMeta } from './crypto'
import type { WatchZone } from './geofence'

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

export interface Location {
  lat: number
  lng: number
  accuracy: number | null
}

export interface ContactInput {
  name: string
  phone: string | null
  email: string | null
  channel: 'sms' | 'email'
}

export interface Contact extends ContactInput {
  id: string
}

export interface SosHistoryItem {
  created_at: string
  trigger: string
  status: string
  delivered: number
  undelivered: number
}

export interface StreamReply {
  stream: boolean
  stream_token: string | null
}

export type UnlockResult = 'ok' | 'denied' | 'offline'

export interface ZoneInput {
  name: string
  kind: 'danger' | 'safe'
  lat: number
  lng: number
  radius: number
}

export interface Zone extends ZoneInput {
  id: string
}

export interface ZoneList {
  zones: Zone[]
  watch: WatchZone[]
  watch_token: string | null
}

export type VaultMetaReply = (VaultMeta & { configured: true }) | { configured: false }

export const api = {
  async setup(realPin: string, duressPin: string) {
    return request<{ account_id: string; offline_real: string; offline_duress: string }>('/auth/setup', 'POST', {
      real_pin: realPin,
      duress_pin: duressPin,
    })
  },

  /** 'ok' for either PIN: real vs duress is invisible to the client. No connection is 'offline'. */
  async unlock(accountId: string, pin: string): Promise<UnlockResult> {
    try {
      const res = await request<{ token: string }>('/auth/unlock', 'POST', { account_id: accountId, pin })
      token = res.token
      return 'ok'
    } catch (e) {
      return e instanceof ApiError && e.status < 500 ? 'denied' : 'offline'
    }
  },

  me() {
    return request<{ account_id: string; created_at: string }>('/me')
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
    return request<{ accepted: boolean }>('/sos', 'POST', { client_ts: clientTs, battery }, authToken)
  },
  sosContext(authToken: string | null, location: Location | null, battery: number | null) {
    return request<StreamReply>('/sos/context', 'POST', { location, battery }, authToken)
  },
  livePoint(streamToken: string, location: Location | null) {
    return request<StreamReply>('/live/point', 'POST', { location }, streamToken)
  },
  liveStatus() {
    return request<{ active: boolean; expires_at: string | null }>('/live/status')
  },
  imSafe() {
    return request<void>('/live/safe', 'POST')
  },
  sosHistory() {
    return request<SosHistoryItem[]>('/sos/history')
  },

  zones(authToken = token) {
    return request<ZoneList>('/zones', 'GET', undefined, authToken)
  },
  createZone(input: ZoneInput) {
    return request<ZoneList>('/zones', 'POST', input)
  },
  deleteZone(id: string) {
    return request<ZoneList>(`/zones/${id}`, 'DELETE')
  },

  sendQueued<T>(path: string, body: unknown, authToken: string) {
    return request<T>(path, 'POST', body, authToken)
  },
  offlineToken(authToken: string | null) {
    return request<{ token: string }>('/offline/token', 'GET', undefined, authToken)
  },
  eraseAccount(pin: string) {
    return request<void>('/account/erase', 'POST', { pin })
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
  vaultEntries() {
    return request<SealedEntry[]>('/vault/entries')
  },
  appendVaultEntry(authToken: string | null, entry: SealedEntry) {
    return request<SealedEntry>('/vault/entries', 'POST', entry, authToken)
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
}
