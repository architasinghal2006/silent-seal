import { createContext, useContext } from 'react'

export interface Session {
  /** Unlocked with no connection: alerts and new evidence queue, everything else waits. */
  offline: boolean
  /** The server has its demo tools on, so simulated parts are labelled and sample data is offered. */
  demo: boolean
  /** Quick exit: drop everything held in memory and return to the calculator. */
  lock: () => void
  /** Panic wipe: clear this phone's data for the app, then return to a fresh calculator. */
  wipe: () => void
}

const SessionContext = createContext<Session | null>(null)

export const SessionProvider = SessionContext.Provider

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside the unlocked app')
  return session
}
