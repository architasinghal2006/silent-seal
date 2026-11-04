import { useRef, useState, type KeyboardEvent } from 'react'

const HOLD_MS = 2000

/** Fires only after a sustained hold, so a stray tap cannot send an alert or wipe anything. */
export function HoldButton({ label, tone = 'danger', onFire }: { label: string; tone?: 'danger' | 'quiet'; onFire: () => void }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  function start() {
    if (timer.current) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = undefined
      setHolding(false)
      onFire()
    }, HOLD_MS)
  }

  function cancel() {
    clearTimeout(timer.current)
    timer.current = undefined
    setHolding(false)
  }

  const isHoldKey = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter'

  return (
    <button
      type="button"
      className={`sos-button sos-${tone}${holding ? ' sos-holding' : ''}`}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (isHoldKey(e)) {
          e.preventDefault()
          if (!e.repeat) start()
        }
      }}
      onKeyUp={(e) => isHoldKey(e) && cancel()}
      onBlur={cancel}
    >
      <span className="sos-fill" aria-hidden="true" />
      <span className="sos-label">{label}</span>
    </button>
  )
}
