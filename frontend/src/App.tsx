import { useCallback, useEffect, useState } from 'react'
import { Calculator } from './calculator/Calculator'
import { IDLE_LOCK_MS } from './config'
import { api, clearToken } from './lib/api'
import { getAccountId } from './lib/storage'
import { Home } from './screens/Home'
import { Setup } from './screens/Setup'

type View = 'calc' | 'setup' | 'app'

/**
 * While anything other than the calculator is visible, return to the calculator on
 * Esc, on the page being hidden (app switch, screen off) and after inactivity.
 */
function useStealthGuards(active: boolean, lock: () => void) {
  useEffect(() => {
    if (!active) return
    let idle = setTimeout(lock, IDLE_LOCK_MS)
    const bump = () => {
      clearTimeout(idle)
      idle = setTimeout(lock, IDLE_LOCK_MS)
    }
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' ? lock() : bump())
    const onVisibility = () => document.visibilityState === 'hidden' && lock()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', bump)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(idle)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', bump)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, lock])
}

export default function App() {
  const [view, setView] = useState<View>('calc')
  const [accountId, setAccount] = useState(getAccountId)

  const lock = useCallback(() => {
    clearToken()
    setView('calc')
  }, [])

  useStealthGuards(view !== 'calc', lock)

  const onPinAttempt = useCallback(
    async (pin: string) => {
      if (!accountId) return false
      const ok = await api.unlock(accountId, pin)
      if (ok) setView('app')
      return ok
    },
    [accountId],
  )

  const onSetupDone = useCallback(() => {
    setAccount(getAccountId())
    setView('calc')
  }, [])

  if (view === 'setup') return <Setup onDone={onSetupDone} onExit={lock} />
  if (view === 'app') return <Home onExit={lock} />
  return (
    <Calculator
      hasAccount={Boolean(accountId)}
      onSetupRequested={() => setView('setup')}
      onPinAttempt={onPinAttempt}
    />
  )
}
