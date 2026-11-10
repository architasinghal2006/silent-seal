import { useCallback, useEffect, useRef, useState } from 'react'
import { matchesSequence } from '../crypto/sequence'
import { display, initialState, press, type Key } from '../utils/calculator'
import { PIN_MODE_TIMEOUT_MS, PIN_PATTERN } from '../utils/config'
import { cx } from '../utils/format'

interface Props {
  hasAccount: boolean
  onSetupRequested: () => void
  /** Resolves true if the PIN unlocked the app. On false we stay a calculator. */
  onPinAttempt: (pin: string) => Promise<boolean>
}

const ROWS: Key[][] = [
  ['AC', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '='],
]

const KEYBOARD: Record<string, Key> = {
  '+': '+', '-': '−', '*': '×', 'x': '×', '/': '÷', '%': '%', '.': '.', ',': '.',
  'Enter': '=', '=': '=', 'Backspace': '⌫', 'Escape': 'AC', 'Delete': 'AC',
}

const SPOKEN: Partial<Record<Key, string>> = {
  'AC': 'Clear', '±': 'Plus or minus', '%': 'Percent', '÷': 'Divide', '×': 'Multiply', '−': 'Subtract', '+': 'Add', '=': 'Equals', '.': 'Decimal point',
}

const isDigit = (k: Key) => k >= '0' && k <= '9' && k.length === 1

function keyClass(k: Key) {
  const base =
    'grid place-items-center rounded-[1.75rem] text-[28px] font-medium shadow-key transition-[filter,transform] duration-100 active:scale-[0.96] active:brightness-95'
  if (k === '=') return cx(base, 'aspect-square bg-mint text-green-deep')
  if (k === '÷' || k === '×' || k === '−' || k === '+') return cx(base, 'aspect-square bg-mint-soft text-green-ink text-[32px]')
  if (k === 'AC' || k === '±' || k === '%') return cx(base, 'aspect-square bg-fill text-ink text-2xl')
  return cx(base, 'bg-card text-ink', k === '0' ? 'col-span-2 justify-start pl-[14%]' : 'aspect-square')
}

/**
 * A fully working calculator, and nothing on it says it is anything else.
 *
 * Typing the secret sequence then "=" silently enters PIN mode. The only hint is a
 * memory-style "M" in the display. The PIN is typed like a number and confirmed with "=".
 * A wrong PIN just shows that number as a normal result: there is no error and no PIN screen.
 */
export function Calculator({ hasAccount, onSetupRequested, onPinAttempt }: Props) {
  const [state, setShownState] = useState(initialState)
  const [pinMode, setShownPinMode] = useState(false)
  // The refs are the truth while keys are being handled: several can be handled between two
  // renders, and each must see what the one before it did.
  const stateRef = useRef(state)
  const pinModeRef = useRef(pinMode)
  // Key presses are handled strictly one after another, so none is lost while a check is in progress.
  const pending = useRef<Promise<void>>(Promise.resolve())
  // Kept apart from the expression, which collapses leading zeros (a PIN can be 0123).
  const pinDigits = useRef('')

  const setState = useCallback((next: typeof initialState) => {
    stateRef.current = next
    setShownState(next)
  }, [])
  const setPinMode = useCallback((on: boolean) => {
    pinModeRef.current = on
    setShownPinMode(on)
  }, [])

  useEffect(() => {
    if (!pinMode) return
    const t = setTimeout(() => setPinMode(false), PIN_MODE_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [pinMode, state, setPinMode])

  const handleKey = useCallback(
    async (key: Key) => {
      const s = stateRef.current

      if (key === '=' && pinModeRef.current) {
        setPinMode(false)
        const pin = pinDigits.current
        pinDigits.current = ''
        if (PIN_PATTERN.test(pin)) {
          const ok = await onPinAttempt(pin).catch(() => false)
          if (ok) {
            setState(initialState)
            return
          }
        }
        setState(press(s, '='))
        return
      }

      if (key === '=' && !s.justEvaluated) {
        const opens = await matchesSequence(s.expr).catch(() => false)
        if (opens) {
          setState(press(s, '='))
          pinDigits.current = ''
          if (hasAccount) setPinMode(true)
          else onSetupRequested()
          return
        }
      }

      // Anything that isn't number entry means the person is just calculating.
      if (pinModeRef.current && !isDigit(key) && key !== '⌫') setPinMode(false)
      if (pinModeRef.current) pinDigits.current = key === '⌫' ? pinDigits.current.slice(0, -1) : pinDigits.current + key
      setState(press(s, key))
    },
    [hasAccount, onPinAttempt, onSetupRequested, setState, setPinMode],
  )

  const handle = useCallback(
    (key: Key) => {
      pending.current = pending.current.then(() => handleKey(key)).catch(() => undefined)
      return pending.current
    },
    [handleKey],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = (/^\d$/.test(e.key) ? e.key : KEYBOARD[e.key]) as Key | undefined
      if (!key) return
      e.preventDefault()
      void handle(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handle])

  const text = display(state)
  const size = text.length > 12 ? 'text-4xl' : text.length > 8 ? 'text-6xl' : 'text-[84px]'

  return (
    <main className="mx-auto flex h-full max-w-[440px] select-none flex-col justify-end px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
      <div
        className="relative flex min-h-36 items-end justify-end overflow-hidden px-2 pb-4"
        onClick={() => void handle('⌫')}
        aria-live="polite"
        data-testid="display"
      >
        <span className="absolute left-2 top-2 text-sm text-muted" aria-hidden="true" data-testid="memory">
          {pinMode ? 'M' : ''}
        </span>
        <span className={cx('whitespace-nowrap font-light leading-none tabular-nums text-ink', size)}>{text}</span>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {ROWS.flat().map((k) => (
          <button key={k} type="button" aria-label={SPOKEN[k]} className={keyClass(k)} onClick={() => void handle(k)}>
            {k}
          </button>
        ))}
      </div>
    </main>
  )
}
