import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { HOLD_MS } from '../../utils/config'
import { cx } from '../../utils/format'

/**
 * Press-and-hold. Fires only after a sustained hold, so a stray tap cannot send an alert or
 * wipe anything. Releasing early cancels. Works with touch, mouse, and Space or Enter.
 * It never makes a sound or vibrates.
 */
function useHold(onFire: () => void, holdMs: number) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const fire = useRef(onFire)
  fire.current = onFire

  function start() {
    if (timer.current) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = undefined
      setHolding(false)
      fire.current()
    }, holdMs)
  }

  function cancel() {
    clearTimeout(timer.current)
    timer.current = undefined
    setHolding(false)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  const isHoldKey = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter'
  const handlers = {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onKeyDown: (e: KeyboardEvent) => {
      if (isHoldKey(e)) {
        e.preventDefault()
        if (!e.repeat) start()
      }
    },
    onKeyUp: (e: KeyboardEvent) => {
      if (isHoldKey(e)) cancel()
    },
    onBlur: cancel,
  }
  return { holding, handlers }
}

const RADIUS = 46
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** The round SOS control: a ring fills as it is held. */
export function HoldRing({
  label,
  hint,
  onFire,
  size = 'lg',
  disabled,
  holdMs = HOLD_MS,
  children,
}: {
  /** The accessible name, e.g. "Hold for 2 seconds to send a silent alert". */
  label: string
  hint?: string
  onFire: () => void
  size?: 'md' | 'lg'
  disabled?: boolean
  holdMs?: number
  children: ReactNode
}) {
  const { holding, handlers } = useHold(onFire, holdMs)
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      {...handlers}
      className={cx(
        'relative grid shrink-0 select-none place-items-center rounded-full bg-card text-ink shadow-raised outline-offset-4',
        'transition-transform duration-150 [-webkit-touch-callout:none] [touch-action:none] disabled:opacity-50',
        size === 'lg' ? 'size-44' : 'size-28',
        holding && 'scale-[0.97]',
      )}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--color-mint)" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="var(--color-danger)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={holding ? 0 : CIRCUMFERENCE}
          style={{ transition: holding ? `stroke-dashoffset ${holdMs}ms linear` : 'stroke-dashoffset 150ms ease-out' }}
        />
      </svg>
      <span className="relative grid place-items-center gap-1 px-4 text-center">
        {children}
        {hint && <span className="text-xs font-medium text-soft">{holding ? 'Keep holding…' : hint}</span>}
      </span>
    </button>
  )
}

/** A wide press-and-hold control: a bar fills across it. Used for panic wipe. */
export function HoldBar({ label, onFire, holdMs = HOLD_MS, tone = 'danger' }: { label: string; onFire: () => void; holdMs?: number; tone?: 'danger' | 'dark' }) {
  const { holding, handlers } = useHold(onFire, holdMs)
  return (
    <button
      type="button"
      {...handlers}
      className={cx(
        'relative min-h-14 w-full select-none overflow-hidden rounded-full px-6 text-base font-semibold text-white [-webkit-touch-callout:none] [touch-action:none]',
        tone === 'danger' ? 'bg-danger-strong' : 'bg-ink',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 origin-left bg-black/30"
        style={{ transform: holding ? 'scaleX(1)' : 'scaleX(0)', transition: holding ? `transform ${holdMs}ms linear` : 'transform 150ms ease-out' }}
      />
      <span className="relative">{holding ? 'Keep holding…' : label}</span>
    </button>
  )
}
