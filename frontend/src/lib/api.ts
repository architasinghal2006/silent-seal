// The session token lives only in memory: closing, reloading or quick-exiting drops it.
let token: string | null = null

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, `request failed: ${res.status}`)
  return (await res.json()) as T
}

export function clearToken() {
  token = null
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
}
