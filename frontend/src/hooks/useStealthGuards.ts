import { useEffect } from 'react'
import { IDLE_LOCK_MS } from '../utils/config'
import { hideLockPaused } from '../utils/guard'

/**
 * While anything other than the calculator is visible, return to the calculator on:
 *  - Escape
 *  - the page being hidden (switching apps, turning the screen off), where the browser reports it
 *  - five minutes with no key press or touch
 *
 * A web app is only told about being hidden after the fact, so the system's app switcher may
 * still show a snapshot of the last screen, and screenshots cannot be prevented.
 */
export function useStealthGuards(active: boolean, lock: () => void, idleMs = IDLE_LOCK_MS) {
  useEffect(() => {
    if (!active) return
    let idle = setTimeout(lock, idleMs)
    const bump = () => {
      clearTimeout(idle)
      idle = setTimeout(lock, idleMs)
    }
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' ? lock() : bump())
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && !hideLockPaused()) lock()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', bump)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', lock)
    return () => {
      clearTimeout(idle)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', bump)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', lock)
    }
  }, [active, lock, idleMs])
}
