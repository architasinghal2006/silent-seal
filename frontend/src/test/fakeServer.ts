// A stand-in for the backend, for tests that run the real app code end to end.
//
// It follows the same rules that matter to the client: both PINs get the same reply, a duress
// session sees an empty account, and a queued event id only takes effect once.
import { vi } from 'vitest'

export const USER = 'a'.repeat(32)
export const REAL_PIN = '2468'
export const DURESS_PIN = '1357'

interface Call {
  method: string
  path: string
  body: any
  token: string | null
}

export function createFakeServer() {
  const state = {
    online: true,
    calls: [] as Call[],
    contacts: [{ id: 'c1', name: 'Asha Verma', relationship: 'Sister', phone: '+919800000001', email: null, channel: 'sms', is_emergency: true }] as any[],
    sos: [] as { id: string; via: string }[],
    seenEvents: new Set<string>(),
    duplicates: 0,
    revoked: new Set<string>(),
    setups: 0,
    unlocks: 0,
  }

  const json = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

  function handle(method: string, path: string, body: any, token: string | null): Response {
    // A new token for every unlock, as on the real server, so a logged-out one stays dead.
    const duress = Boolean(token?.startsWith('session-duress'))
    const session = Boolean(token?.startsWith('session-real')) || duress

    if (method === 'POST' && path === '/auth/setup') {
      state.setups += 1
      return json({ user_id: USER, offline_real: 'offline-real', offline_duress: 'offline-duress' }, 201)
    }
    if (method === 'POST' && path === '/auth/unlock') {
      if (body.user_id !== USER) return json({ detail: 'invalid' }, 401)
      if (body.pin === REAL_PIN) return json({ token: `session-real-${++state.unlocks}`, expires_in: 1800 })
      if (body.pin === DURESS_PIN) {
        state.sos.push({ id: `e${state.sos.length + 1}`, via: 'duress-unlock' })
        return json({ token: `session-duress-${++state.unlocks}`, expires_in: 1800 })
      }
      return json({ detail: 'invalid' }, 401)
    }
    if (method === 'POST' && path === '/offline/sync') {
      if (token !== 'offline-real' && token !== 'offline-duress') return json({ detail: 'unauthorized' }, 401)
      const results = body.events.map((event: any) => {
        if (state.seenEvents.has(event.id)) {
          state.duplicates += 1
          return { id: event.id, status: 'duplicate' }
        }
        state.seenEvents.add(event.id)
        if (event.type === 'sos' || (event.type === 'unlock' && token === 'offline-duress')) state.sos.push({ id: event.id, via: `queued-${event.type}` })
        return { id: event.id, status: 'applied' }
      })
      return json({ results, stream: false, stream_token: null })
    }

    if (!session || state.revoked.has(token!)) return json({ detail: 'unauthorized' }, 401)

    if (method === 'POST' && path === '/auth/logout') {
      state.revoked.add(token!)
      return json(null, 204)
    }
    if (path === '/me') return json({ user_id: USER, created_at: '2026-11-01T00:00:00', demo: false })
    if (path === '/contacts' && method === 'GET') return json(duress ? [] : state.contacts)
    if (path === '/contacts' && method === 'POST') {
      const contact = { ...body, id: `c${state.contacts.length + 1}` }
      if (!duress) state.contacts.push(contact)
      return json(contact, 201)
    }
    if (path.startsWith('/contacts/') && method === 'PUT') {
      const id = path.split('/')[2]
      state.contacts = state.contacts.map((c) => (c.id === id ? { ...body, id } : c))
      return json({ ...body, id })
    }
    if (path.startsWith('/contacts/') && method === 'DELETE') {
      state.contacts = state.contacts.filter((c) => c.id !== path.split('/')[2])
      return json(null, 204)
    }
    if (path === '/profile') return json({ alert_name: method === 'PUT' ? body.alert_name : duress ? '' : 'Ananya' })
    if (path === '/zones') return json({ zones: [], watch: [], watch_token: null })
    if (path === '/vault/meta') return json({ configured: false })
    if (path === '/live-share') return json({ active: false, started_at: null, expires_at: null, share_url: null, points: [], viewers: [] })
    if (path === '/sos/history') return json([])
    if (path === '/sos/context') return json({ stream: false, stream_token: null })
    if (path === '/sos' && method === 'POST') {
      const id = `e${state.sos.length + 1}`
      state.sos.push({ id, via: duress ? 'manual-in-duress' : 'manual' })
      return json({ accepted: true, event_id: id }, 202)
    }
    if (path.startsWith('/sos/')) {
      return json({
        id: path.split('/')[2],
        created_at: '2026-11-10T10:00:00',
        trigger: 'manual',
        status: 'dispatched',
        location_captured: false,
        battery: null,
        deliveries: [{ contact_name: 'Asha Verma', channel: 'sms', adapter: 'mock', status: 'sent', kind: 'initial' }],
        live_share_active: true,
      })
    }
    if (path === '/offline/token') return json({ token: duress ? 'offline-duress' : 'offline-real' })
    if (path === '/offline/status') return json({ last_sync_at: null, applied: 0, duplicates: 0 })
    return json({ detail: 'Not Found' }, 404)
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!state.online) throw new TypeError('Failed to fetch')
    const path = String(input).replace(/^\/api/, '')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization
    const token = auth ? auth.replace('Bearer ', '') : null
    state.calls.push({ method, path, body, token })
    return handle(method, path, body, token)
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    state,
    calls: (method: string, path: string) => state.calls.filter((c) => c.method === method && c.path === path),
    clearCalls: () => (state.calls.length = 0),
  }
}
