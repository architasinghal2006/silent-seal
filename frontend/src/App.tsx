import { useCallback, useEffect, useState } from 'react'
import { Calculator } from './calculator/Calculator'
import { IDLE_LOCK_MS } from './config'
import { api, clearToken } from './lib/api'
import { hideLockPaused } from './lib/guard'
import { sendUnlockContext } from './lib/sos'
import { getAccountId } from './lib/storage'
import { resumeStream } from './lib/stream'
import { startQueue } from './lib/queue'
import { clearLocalSession, syncAfterUnlock, unlockOffline } from './lib/session'
import { lockVault } from './lib/vault'
import { startWatcher } from './lib/watcher'
import { wipeDevice } from './lib/wipe'
import { Contacts } from './screens/Contacts'
import { Home } from './screens/Home'
import { Safety } from './screens/Safety'
import { Setup } from './screens/Setup'
import { Vault } from './screens/Vault'
import { Zones } from './screens/Zones'

type View = 'calc' | 'setup' | 'app' | 'contacts' | 'vault' | 'zones' | 'safety'

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
  const [offline, setOffline] = useState(false)

  const lock = useCallback(() => {
    clearToken()
    lockVault()
    clearLocalSession()
    setOffline(false)
    setView('calc')
  }, [])

  useStealthGuards(view !== 'calc', lock)
  useEffect(() => {
    // All silent and with no session: these keep working on the calculator.
    resumeStream()
    startQueue()
    startWatcher()
  }, [])

  const onPinAttempt = useCallback(
    async (pin: string) => {
      if (!accountId) return false
      const result = await api.unlock(accountId, pin)
      if (result === 'ok') {
        sendUnlockContext()
        void syncAfterUnlock(pin).catch(() => undefined)
        setOffline(false)
        setView('app')
        return true
      }
      if (result === 'offline' && (await unlockOffline(pin))) {
        setOffline(true)
        setView('app')
        return true
      }
      return false
    },
    [accountId],
  )

  const wipe = useCallback(() => {
    setAccount(undefined)
    setOffline(false)
    setView('calc')
    void wipeDevice()
  }, [])

  const onSetupDone = useCallback(() => {
    setAccount(getAccountId())
    setView('calc')
  }, [])

  if (view === 'setup') return <Setup onDone={onSetupDone} onExit={lock} />
  if (view === 'app') {
    return (
      <Home
        offline={offline}
        onExit={lock}
        onWipe={wipe}
        onContacts={() => setView('contacts')}
        onVault={() => setView('vault')}
        onZones={() => setView('zones')}
        onSafety={() => setView('safety')}
      />
    )
  }
  if (view === 'vault') return <Vault offline={offline} onBack={() => setView('app')} onExit={lock} />
  if (view === 'zones') return <Zones onBack={() => setView('app')} onExit={lock} />
  if (view === 'safety') return <Safety onBack={() => setView('app')} onExit={lock} onErased={wipe} />
  if (view === 'contacts') return <Contacts onBack={() => setView('app')} onExit={lock} />
  return (
    <Calculator
      hasAccount={Boolean(accountId)}
      onSetupRequested={() => setView('setup')}
      onPinAttempt={onPinAttempt}
    />
  )
}
