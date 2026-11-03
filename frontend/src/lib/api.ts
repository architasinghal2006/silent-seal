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
    keepalive: method === 'POST',
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

export const api = {
  async setup(realPin: string, duressPin: string) {
    return request<{ account_id: string }>('/auth/setup', 'POST', { real_pin: realPin, duress_pin: duressPin })
  },

  /** Resolves true when either PIN is accepted. Real vs duress is invisible to the client. */
  async unlock(accountId: string, pin: string): Promise<boolean> {
    try {
      const res = await request<{ token: string }>('/auth/unlock', 'POST', { account_id: accountId, pin })
      token = res.token
      return true
    } catch {
      return false
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
}
