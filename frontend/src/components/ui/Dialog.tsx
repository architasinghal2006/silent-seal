import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconButton } from './Button'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A panel over the page: a sheet rising from the bottom on a phone, a centred dialog on wider screens.
 * Focus moves in and stays in, and returns to where it was on close.
 *
 * Escape is deliberately not handled here. Everywhere in the app, Escape is quick exit.
 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select')
    ;(first ?? panel.current)?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  function keepFocusInside(event: React.KeyboardEvent) {
    if (event.key !== 'Tab' || !panel.current) return
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-ink/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
        className="relative flex max-h-[92dvh] w-full animate-sheet-in flex-col rounded-t-sheet bg-card shadow-raised outline-none sm:max-w-lg sm:rounded-sheet"
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
          <h2 id={titleId} className="text-xl font-bold">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={22} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap gap-3 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** A yes/no question before something that matters. The confirm button says what will happen. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Cancel',
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  busyLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Sheet
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant={danger ? 'danger' : 'dark'} loading={busy} onClick={onConfirm} className="flex-1" data-autofocus>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCancel} className="flex-1">
            {cancelLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-[15px] text-soft">{children}</div>
      {error && (
        <p role="alert" className="mt-3 font-medium text-danger-ink">
          {error}
        </p>
      )}
    </Sheet>
  )
}
