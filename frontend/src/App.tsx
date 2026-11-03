import { useCallback, useEffect, useState } from 'react'
import { Calculator } from './calculator/Calculator'
import { IDLE_LOCK_MS } from './config'
import { api, clearToken } from './lib/api'
import { hideLockPaused } from './lib/guard'
import { sendUnlockContext } from './lib/sos'
import { getAccountId } from './lib/storage'
import { resumeStream } from './lib/stream'
import { lockVault } from './lib/vault'
import { Contacts } from './screens/Contacts'
import { Home } from './screens/Home'
import { Setup } from './screens/Setup'
import { Vault } from './screens/Vault'

type View = 'calc' | 'setup' | 'app' | 'contacts' | 'vault'

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
    const onVisibility = () => document.visibilityState === 'hidden' && !hideLockPaused() && lock()
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
    lockVault()
    setView('calc')
  }, [])

  useStealthGuards(view !== 'calc', lock)
  useEffect(resumeStream, [])

  const onPinAttempt = useCallback(
    async (pin: string) => {
      if (!accountId) return false
      const ok = await api.unlock(accountId, pin)
      if (ok) {
        sendUnlockContext()
        setView('app')
      }
      return ok
    },
    [accountId],
  )

  const onSetupDone = useCallback(() => {
    setAccount(getAccountId())
    setView('calc')
  }, [])

  if (view === 'setup') return <Setup onDone={onSetupDone} onExit={lock} />
  if (view === 'app') return <Home onExit={lock} onContacts={() => setView('contacts')} onVault={() => setView('vault')} />
  if (view === 'vault') return <Vault onBack={() => setView('app')} onExit={lock} />
  if (view === 'contacts') return <Contacts onBack={() => setView('app')} onExit={lock} />
  return (
    <Calculator
      hasAccount={Boolean(accountId)}
      onSetupRequested={() => setView('setup')}
      onPinAttempt={onPinAttempt}
    />
  )
}
