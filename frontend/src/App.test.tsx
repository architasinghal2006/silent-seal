// @vitest-environment jsdom
//
// Whole journeys through the real app: real components, real crypto, real queue. Only the
// network is replaced, by a fake server that follows the backend's rules.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createRecords } from './crypto/localUnlock'
import { deleteQueue, flushQueue, listQueue } from './offline/queue'
import { clearToken, sessionToken } from './services/api'
import { LOCKOUT_MS, resetThrottle } from './services/unlockThrottle'
import { createFakeServer, DURESS_PIN, REAL_PIN, USER } from './test/fakeServer'
import { HOLD_MS } from './utils/config'
import { setStayOnStatus, setUserId } from './utils/storage'

let server: ReturnType<typeof createFakeServer>

beforeEach(async () => {
  server = createFakeServer()
  clearToken()
  resetThrottle()
  await deleteQueue()
})

const NAMES: Record<string, string> = { '=': 'Equals' }

function typeOnCalculator(keys: string) {
  for (const key of keys) fireEvent.click(screen.getByRole('button', { name: NAMES[key] ?? key }))
}

const display = () => screen.getByTestId('display').textContent?.replace('M', '')
const onCalculator = () => screen.queryByTestId('display') !== null

async function unlockWith(pin: string) {
  typeOnCalculator('1379=')
  await waitFor(() => expect(screen.getByTestId('memory')).toHaveTextContent('M'))
  typeOnCalculator(`${pin}=`)
}

async function openApp(pin = REAL_PIN) {
  setUserId(USER)
  render(<App />)
  await unlockWith(pin)
  await screen.findByRole('heading', { name: /Ready when you need it|to set up/ }, { timeout: 15000 })
}

async function holdSos() {
  const button = screen.getAllByRole('button', { name: /Hold for 2 seconds to send a silent alert/ })[0]
  fireEvent.pointerDown(button)
  await act(() => new Promise((resolve) => setTimeout(resolve, HOLD_MS + 150)))
}

describe('unlocking', () => {
  it('opens the real safety dashboard with the real PIN', { timeout: 30000 }, async () => {
    await openApp(REAL_PIN)
    expect(await screen.findByText('1 emergency contact will be alerted')).toBeInTheDocument()
    expect(server.state.sos).toEqual([])
  })

  it('opens the same-looking app, emptied, with the duress PIN, and the alert is raised only on the server', async () => {
    await openApp(DURESS_PIN)

    // The decoy: same screens, no contacts, no history, no sign anything was sent.
    expect(await screen.findByText(/won’t reach anyone until you add an emergency contact/)).toBeInTheDocument()
    expect(screen.queryByText('Asha Verma')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/duress/i)
    expect(server.state.sos).toEqual([{ id: 'e1', via: 'duress-unlock' }])
  })

  it('does the same work after either PIN, so the phone cannot tell them apart', { timeout: 30000 }, async () => {
    const paths = async (pin: string) => {
      const { unmount } = render(<App />)
      await unlockWith(pin)
      await screen.findByRole('heading', { name: /Ready when you need it|to set up/ })
      // Background work after an unlock arrives over a few moments: wait until it has all landed.
      let seen = -1
      await waitFor(
        () => {
          const now = server.state.calls.length
          const settled = now === seen
          seen = now
          expect(settled).toBe(true)
        },
        { interval: 400, timeout: 8000 },
      )
      const made = server.state.calls.map((c) => `${c.method} ${c.path}`).sort()
      unmount()
      clearToken()
      server.clearCalls()
      return made
    }
    setUserId(USER)
    await createRecords(REAL_PIN, 'offline-real', DURESS_PIN, 'offline-duress', 1000)
    expect(await paths(REAL_PIN)).toEqual(await paths(DURESS_PIN))
  })

  it('shows a wrong PIN as a plain result and stays a calculator', async () => {
    setUserId(USER)
    render(<App />)
    await unlockWith('9999')
    await waitFor(() => expect(server.calls('POST', '/auth/unlock')).toHaveLength(1))
    expect(display()).toBe('9999')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('pauses unlocking for a minute after five wrong PINs, while the calculator keeps working', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      setUserId(USER)
      render(<App />)
      for (let attempt = 1; attempt <= 5; attempt++) {
        await unlockWith('0000')
        await waitFor(() => expect(server.calls('POST', '/auth/unlock')).toHaveLength(attempt))
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      }

      // Locked: even the right PIN is refused without being checked, and just shows as a number.
      await unlockWith(REAL_PIN)
      await waitFor(() => expect(display()).toBe(REAL_PIN))
      expect(server.calls('POST', '/auth/unlock')).toHaveLength(5)
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      typeOnCalculator('2')
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
      typeOnCalculator('2=')
      await waitFor(() => expect(display()).toBe('4'))

      vi.setSystemTime(Date.now() + LOCKOUT_MS + 1000)
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      await unlockWith(REAL_PIN)
      await screen.findByRole('heading', { name: /Ready when you need it|to set up/ })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('leaving', () => {
  it('returns to the calculator on Exit, ends the session and keeps nothing sensitive in storage', async () => {
    await openApp()
    await userEvent.click(screen.getByRole('button', { name: 'Quick exit to calculator' }))

    expect(onCalculator()).toBe(true)
    expect(sessionToken()).toBeNull()
    await waitFor(() => expect([...server.state.revoked].some((t) => t.startsWith('session-real'))).toBe(true))
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(stored).not.toContain('session-real')
    expect(stored).not.toContain(REAL_PIN)
  })

  it('returns to the calculator on Escape and when the page is hidden', async () => {
    await openApp()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(onCalculator()).toBe(true))

    await unlockWith(REAL_PIN)
    await screen.findByRole('heading', { name: /Ready when you need it|to set up/ })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    fireEvent(document, new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await waitFor(() => expect(onCalculator()).toBe(true))
  })

  it('opens on the home screen after every unlock, whatever screen was left', async () => {
    await openApp()
    await userEvent.click(within(screen.getAllByRole('navigation', { name: 'Main' })[0]).getByRole('link', { name: 'Contacts' }))
    await screen.findByRole('heading', { name: 'Trusted contacts' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await unlockWith(REAL_PIN)
    await screen.findByRole('heading', { name: /Ready when you need it|to set up/ })
  })
})

describe('silent SOS', () => {
  it('does nothing on a tap', async () => {
    await openApp()
    const button = screen.getAllByRole('button', { name: /Hold for 2 seconds/ })[0]
    fireEvent.pointerDown(button)
    fireEvent.pointerUp(button)
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    expect(server.calls('POST', '/sos')).toHaveLength(0)
    expect(onCalculator()).toBe(false)
  })

  it('after a 2-second hold, sends the alert and returns to the calculator showing nothing', async () => {
    await openApp()
    await holdSos()

    expect(onCalculator()).toBe(true)
    expect(display()).toBe('0')
    await waitFor(() => expect(server.state.sos).toEqual([{ id: 'e1', via: 'manual' }]))
    // The location follow-up still goes out after the app has locked, and only then is the session ended.
    await waitFor(() => expect(server.calls('POST', '/sos/context').length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect([...server.state.revoked].some((t) => t.startsWith('session-real'))).toBe(true))
  }, 15000)

  it('can instead stay and show each step once the server confirms it, labelling simulated delivery', async () => {
    setStayOnStatus(true)
    await openApp()
    await holdSos()

    expect(await screen.findByText('Alert received by the server')).toBeInTheDocument()
    expect(await screen.findByText('Simulated: recorded, not sent')).toBeInTheDocument()
    expect(screen.getByText('Live location sharing is on')).toBeInTheDocument()
    expect(screen.queryByText(/^Sent$/)).not.toBeInTheDocument()
  }, 15000)
})

describe('offline', () => {
  async function openOffline(pin: string) {
    setUserId(USER)
    await createRecords(REAL_PIN, 'offline-real', DURESS_PIN, 'offline-duress', 1000)
    server.state.online = false
    render(<App />)
    await unlockWith(pin)
    await screen.findByRole('heading', { name: 'You’re offline' }, { timeout: 5000 })
  }

  it('unlocks with no connection and refuses a wrong PIN', async () => {
    setUserId(USER)
    await createRecords(REAL_PIN, 'offline-real', DURESS_PIN, 'offline-duress', 1000)
    server.state.online = false
    render(<App />)
    await unlockWith('4321')
    await waitFor(() => expect(display()).toBe('4321'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await unlockWith(REAL_PIN)
    await screen.findByRole('heading', { name: 'You’re offline' })
  })

  it('queues an alert, reports it as not sent, then delivers it exactly once when back online', async () => {
    setStayOnStatus(true)
    await openOffline(REAL_PIN)
    await holdSos()

    expect(await screen.findByText('Saved on this phone, not sent yet')).toBeInTheDocument()
    expect(screen.queryByText('Alert received by the server')).not.toBeInTheDocument()
    await waitFor(async () => expect((await listQueue()).map((i) => i.type).sort()).toEqual(['sos', 'unlock']))
    expect(server.state.sos).toEqual([])

    server.state.online = true
    await flushQueue({ force: true })

    await waitFor(async () => expect(await listQueue()).toEqual([]))
    expect(server.state.sos.map((s) => s.via)).toEqual(['queued-sos'])
  }, 15000)

  it('never alerts twice when the reply is lost and the phone sends again', async () => {
    await openOffline(REAL_PIN)
    await holdSos()
    await waitFor(async () => expect((await listQueue()).length).toBe(2))

    // The server handles the events, but the phone never hears back.
    server.state.online = true
    const queued = await listQueue()
    for (const item of queued) server.state.seenEvents.add(item.id)
    server.state.sos.push({ id: 'first-delivery', via: 'queued-sos' })

    await flushQueue({ force: true })

    expect(server.state.sos).toHaveLength(1)
    expect(server.state.duplicates).toBe(2)
    expect(await listQueue()).toEqual([])
  }, 15000)

  it('reports an offline duress unlock the same way as a real one, and only the server acts on it', async () => {
    await openOffline(DURESS_PIN)
    await waitFor(async () => expect((await listQueue()).map((i) => i.type)).toEqual(['unlock']))
    const [item] = await listQueue()
    // What the phone stores says only that an unlock happened: nothing marks it as forced.
    expect(Object.keys(item.payload).sort()).toEqual(['battery', 'location'])

    server.state.online = true
    await waitFor(async () => {
      await flushQueue({ force: true })
      expect(server.state.sos.map((s) => s.via)).toEqual(['queued-unlock'])
    })
  })
})

describe('panic wipe', () => {
  it('needs a 2-second hold, then clears this phone and leaves a fresh calculator', async () => {
    await openApp()
    await userEvent.click(screen.getByRole('link', { name: 'Safety and settings' }))
    const wipe = await screen.findByRole('button', { name: 'Hold to wipe this phone' })

    fireEvent.pointerDown(wipe)
    fireEvent.pointerUp(wipe)
    expect(localStorage.getItem('calc.prefs')).toContain(USER)

    fireEvent.pointerDown(wipe)
    await act(() => new Promise((resolve) => setTimeout(resolve, HOLD_MS + 150)))

    expect(onCalculator()).toBe(true)
    await waitFor(() => expect(localStorage.length).toBe(0))
    expect(sessionToken()).toBeNull()
    // Nothing on the server is deleted by a wipe.
    expect(server.state.calls.some((c) => c.path === '/account/erase')).toBe(false)

    // The phone now behaves as if never set up: the starting sequence leads to setup, not a PIN.
    typeOnCalculator('1379=')
    expect(await screen.findByRole('heading', { name: 'A private way to ask for help.' })).toBeInTheDocument()
  }, 15000)
})
