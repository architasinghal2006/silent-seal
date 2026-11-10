import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { startWatcher } from './geolocation/watcher'
import { useStealthGuards } from './hooks/useStealthGuards'
import { startQueue } from './offline/queue'
import { Calculator } from './pages/Calculator'
import { api } from './services/api'
import { resumeStream } from './services/liveStream'
import { syncAfterUnlock, unlockOffline } from './services/session'
import { sendUnlockContext } from './services/sos'
import { recordFailure, recordSuccess, unlockAllowed } from './services/unlockThrottle'
import { lockSession, wipeDevice } from './services/wipe'
import { getUserId } from './utils/storage'

// Everything behind the calculator loads only once it is needed, so a phone that is only
// ever used as a calculator never runs any of it. The service worker keeps these files for offline use.
const SafetyApp = lazy(() => import('./layouts/SafetyApp'))
const Onboarding = lazy(() => import('./pages/onboarding/Onboarding'))

type Stage = 'calculator' | 'onboarding' | 'app'

export default function App() {
  const [stage, setStage] = useState<Stage>('calculator')
  const [userId, setUser] = useState(getUserId)
  const [offline, setOffline] = useState(false)
  const [demo, setDemo] = useState(false)
  // A fresh router for every unlock, so the app always opens on its home screen.
  const [unlocks, setUnlocks] = useState(0)

  const lock = useCallback(() => {
    lockSession()
    setOffline(false)
    setStage('calculator')
  }, [])

  useStealthGuards(stage !== 'calculator', lock)

  useEffect(() => {
    // All silent and with no session: these keep working on the calculator.
    resumeStream()
    startQueue()
    startWatcher()
  }, [])

  const onPinAttempt = useCallback(
    async (pin: string) => {
      // During a lockout nothing is checked at all, and the calculator just shows the number.
      if (!userId || !unlockAllowed()) return false

      const result = await api.unlock(userId, pin)
      if (result === 'ok') {
        recordSuccess()
        sendUnlockContext()
        void syncAfterUnlock(pin).catch(() => undefined)
        void api.me().then((me) => setDemo(me.demo)).catch(() => undefined)
        setOffline(false)
        setUnlocks((n) => n + 1)
        setStage('app')
        return true
      }
      if (result === 'offline' && (await unlockOffline(pin))) {
        recordSuccess()
        setOffline(true)
        setUnlocks((n) => n + 1)
        setStage('app')
        return true
      }
      recordFailure()
      return false
    },
    [userId],
  )

  const wipe = useCallback(() => {
    setUser(undefined)
    setOffline(false)
    setStage('calculator')
    void wipeDevice()
  }, [])

  const onSetupDone = useCallback(() => {
    lockSession()
    setUser(getUserId())
    setStage('calculator')
  }, [])

  if (stage === 'calculator') {
    return <Calculator hasAccount={Boolean(userId)} onSetupRequested={() => setStage('onboarding')} onPinAttempt={onPinAttempt} />
  }

  return (
    // Nothing is shown while a screen loads: a spinner here would flash on every unlock.
    <Suspense fallback={null}>
      {stage === 'onboarding' ? (
        <Onboarding onDone={onSetupDone} onExit={lock} />
      ) : (
        <SafetyApp key={unlocks} session={{ offline, demo, lock, wipe }} />
      )}
    </Suspense>
  )
}
