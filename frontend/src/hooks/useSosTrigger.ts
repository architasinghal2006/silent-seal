import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../contexts/SessionContext'
import { fireSos, type SosOutcome } from '../services/sos'
import { getStayOnStatus } from '../utils/storage'

/** What the SOS screen is handed when it is asked to show how an alert is going. */
export interface SosAttempt {
  startedAt: number
  outcome: Promise<SosOutcome>
}

/**
 * Sends a silent alert. By default the app then returns straight to the calculator with no
 * trace on screen, and the alert finishes in the background. If the survivor has chosen to
 * stay, the SOS screen shows each step as the server confirms it.
 */
export function useSosTrigger(): () => void {
  const { lock } = useSession()
  const navigate = useNavigate()
  return useCallback(() => {
    const attempt: SosAttempt = { startedAt: Date.now(), outcome: fireSos() }
    if (getStayOnStatus()) navigate('/sos', { state: { attempt } })
    else lock()
  }, [lock, navigate])
}
