import { useCallback, useEffect, useRef, useState } from 'react'
import { PIN_MODE_TIMEOUT_MS, UNLOCK_SEQUENCE } from '../config'
import { display, initialState, press, type Key } from './engine'

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

const isDigit = (k: Key) => k >= '0' && k <= '9' && k.length === 1

function keyClass(k: Key) {
  if (k === '÷' || k === '×' || k === '−' || k === '+' || k === '=') return 'key key-op'
  if (k === 'AC' || k === '±' || k === '%') return 'key key-fn'
  return k === '0' ? 'key key-wide' : 'key'
}

/**
 * A fully working calculator. Typing UNLOCK_SEQUENCE then "=" silently enters PIN mode
 * (only hint: a memory-style "M" in the display). The PIN is typed like a number and
 * confirmed with "=". Any wrong PIN just shows that number as a normal result.
 */
export function Calculator({ hasAccount, onSetupRequested, onPinAttempt }: Props) {
  const [state, setState] = useState(initialState)
  const [pinMode, setPinMode] = useState(false)
  const stateRef = useRef(state)
  const pinModeRef = useRef(pinMode)
  const busy = useRef(false)
  stateRef.current = state
  pinModeRef.current = pinMode

  useEffect(() => {
    if (!pinMode) return
    const t = setTimeout(() => setPinMode(false), PIN_MODE_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [pinMode, state])

  const handle = useCallback(
    async (key: Key) => {
      if (busy.current) return
      const s = stateRef.current

      if (key === '=' && pinModeRef.current) {
        setPinMode(false)
        const pin = s.justEvaluated ? '' : s.expr
        if (/^\d{4,8}$/.test(pin)) {
          busy.current = true
          const ok = await onPinAttempt(pin).catch(() => false)
          busy.current = false
          if (ok) {
            setState(initialState)
            return
          }
        }
        setState(press(s, '='))
        return
      }

      if (key === '=' && !s.justEvaluated && s.expr === UNLOCK_SEQUENCE) {
        setState(press(s, '='))
        if (hasAccount) setPinMode(true)
        else onSetupRequested()
        return
      }

      // Anything that isn't number entry means the person is just calculating.
      if (pinModeRef.current && !isDigit(key) && key !== '⌫') setPinMode(false)
      setState(press(s, key))
    },
    [hasAccount, onPinAttempt, onSetupRequested],
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
  const size = text.length > 12 ? 'display-sm' : text.length > 8 ? 'display-md' : ''

  return (
    <main className="calc">
      <div className="calc-display" onClick={() => void handle('⌫')} aria-live="polite">
        <span className="calc-mem" aria-hidden="true">{pinMode ? 'M' : ''}</span>
        <span className={`calc-value ${size}`}>{text}</span>
      </div>
      <div className="calc-keys">
        {ROWS.flat().map((k) => (
          <button key={k} type="button" className={keyClass(k)} onClick={() => void handle(k)}>
            {k}
          </button>
        ))}
      </div>
    </main>
  )
}
