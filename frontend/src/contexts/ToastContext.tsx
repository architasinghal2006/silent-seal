import { Check, CircleAlert, Info } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { cx } from '../utils/format'

type ToastTone = 'ok' | 'info' | 'error'

interface Toast {
  id: number
  tone: ToastTone
  message: string
}

type ShowToast = (message: string, tone?: ToastTone) => void

const ToastContext = createContext<ShowToast>(() => undefined)

/** Confirms something the survivor just did. A component outside a provider gets a no-op. */
export function useToast(): ShowToast {
  return useContext(ToastContext)
}

const TOAST_MS = 4500

const ICONS = { ok: Check, info: Info, error: CircleAlert }

/**
 * Short on-screen confirmations inside the unlocked app. They are visual only: no sound, no
 * vibration and never a system notification, any of which could be noticed by someone nearby.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const show = useCallback<ShowToast>((message, tone = 'ok') => {
    const id = nextId.current++
    setToasts((current) => [...current.slice(-2), { id, tone, message }])
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), TOAST_MS)
  }, [])

  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[1300] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone]
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className={cx(
                'pointer-events-auto flex max-w-md animate-sheet-in items-center gap-3 rounded-full px-5 py-3 text-[15px] font-semibold shadow-raised',
                toast.tone === 'error' ? 'bg-danger-strong text-white' : 'bg-ink text-white',
              )}
            >
              <Icon size={18} aria-hidden="true" className={toast.tone === 'ok' ? 'text-mint' : undefined} />
              <span>{toast.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
