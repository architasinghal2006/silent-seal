// A small, eval-free calculator. State is just the expression string the user sees.

export type Op = '+' | '−' | '×' | '÷'
export type Key =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '.' | Op | '=' | 'AC' | '⌫' | '%' | '±'

export interface CalcState {
  expr: string
  justEvaluated: boolean
}

export const initialState: CalcState = { expr: '', justEvaluated: false }

const OPS: readonly string[] = ['+', '−', '×', '÷']
const MAX_DIGITS = 15
export const ERROR = 'Error'

const isOp = (c: string | undefined) => c !== undefined && OPS.includes(c)
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'

/** Start index of the trailing number (including a unary minus), or -1. */
function lastNumberStart(expr: string): number {
  let i = expr.length - 1
  if (expr[i] === '%') i--
  while (i >= 0 && (isDigit(expr[i]) || expr[i] === '.')) i--
  const start = i + 1
  if (start >= expr.length) return -1
  // A minus at the start or right after another operator is a sign, not subtraction.
  if (expr[i] === '−' && (i === 0 || isOp(expr[i - 1]))) return i
  return start
}

export function display(state: CalcState): string {
  return state.expr === '' ? '0' : state.expr
}

export function press(state: CalcState, key: Key): CalcState {
  const { expr, justEvaluated } = state
  const fresh = justEvaluated || expr === ERROR

  if (key === 'AC') return initialState

  if (key === '⌫') {
    if (fresh) return initialState
    return { expr: expr.slice(0, -1), justEvaluated: false }
  }

  if (isDigit(key)) {
    if (fresh) return { expr: key, justEvaluated: false }
    const start = lastNumberStart(expr)
    const current = start === -1 ? '' : expr.slice(start)
    if (current.endsWith('%')) return state
    if (current.replace(/[−.]/g, '').length >= MAX_DIGITS) return state
    // Replace a lone leading zero ("0" -> "7", "−0" -> "−7").
    if (current === '0' || current === '−0') return { expr: expr.slice(0, -1) + key, justEvaluated: false }
    return { expr: expr + key, justEvaluated: false }
  }

  if (key === '.') {
    if (fresh) return { expr: '0.', justEvaluated: false }
    const start = lastNumberStart(expr)
    const current = start === -1 ? '' : expr.slice(start)
    if (current.includes('.') || current.endsWith('%')) return state
    const needsZero = current === '' || current === '−'
    return { expr: expr + (needsZero ? '0.' : '.'), justEvaluated: false }
  }

  if (isOp(key)) {
    if (expr === ERROR) return state
    if (expr === '') return { expr: key === '−' ? '−' : '0' + key, justEvaluated: false }
    if (expr === '−') return state
    const last = expr[expr.length - 1]
    if (isOp(last)) {
      // "5×" + "−" starts a negative number; otherwise swap the operator.
      if (key === '−' && (last === '×' || last === '÷')) return { expr: expr + key, justEvaluated: false }
      const trimmed = isOp(expr[expr.length - 2]) ? expr.slice(0, -2) : expr.slice(0, -1)
      return { expr: trimmed + key, justEvaluated: false }
    }
    const base = last === '.' ? expr.slice(0, -1) : expr
    return { expr: base + key, justEvaluated: false }
  }

  if (key === '%') {
    if (expr === ERROR) return state
    const last = expr[expr.length - 1]
    if (isDigit(last)) return { expr: expr + '%', justEvaluated: false }
    return state
  }

  if (key === '±') {
    if (expr === ERROR || expr === '') return state
    const start = lastNumberStart(expr)
    if (start === -1) return state
    const next = expr[start] === '−' ? expr.slice(0, start) + expr.slice(start + 1) : expr.slice(0, start) + '−' + expr.slice(start)
    return { expr: next, justEvaluated: false }
  }

  // '='
  if (expr === '' || fresh) return state
  return { expr: evaluate(expr), justEvaluated: true }
}

/** Evaluate an expression using standard precedence. Returns a display string or "Error". */
export function evaluate(expr: string): string {
  let src = expr
  while (src.length && (isOp(src[src.length - 1]) || src.endsWith('.'))) src = src.slice(0, -1)
  if (!src) return '0'

  const nums: number[] = []
  const ops: Op[] = []
  let i = 0
  while (i < src.length) {
    let sign = 1
    if (src[i] === '−') {
      sign = -1
      i++
    }
    let j = i
    while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j++
    if (j === i) return ERROR
    let n = sign * parseFloat(src.slice(i, j))
    if (src[j] === '%') {
      n /= 100
      j++
    }
    nums.push(n)
    if (j < src.length) {
      if (!isOp(src[j])) return ERROR
      ops.push(src[j] as Op)
      j++
    }
    i = j
  }

  // Pass 1: × and ÷
  const sumNums = [nums[0]]
  const sumOps: Op[] = []
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    const rhs = nums[k + 1]
    if (op === '×' || op === '÷') {
      if (op === '÷' && rhs === 0) return ERROR
      const lhs = sumNums.pop()!
      sumNums.push(op === '×' ? lhs * rhs : lhs / rhs)
    } else {
      sumOps.push(op)
      sumNums.push(rhs)
    }
  }
  // Pass 2: + and −
  let result = sumNums[0]
  for (let k = 0; k < sumOps.length; k++) {
    result = sumOps[k] === '+' ? result + sumNums[k + 1] : result - sumNums[k + 1]
  }
  return format(result)
}

export function format(n: number): string {
  if (!Number.isFinite(n)) return ERROR
  const rounded = parseFloat(n.toPrecision(12))
  const abs = Math.abs(rounded)
  let out = abs !== 0 && (abs >= 1e15 || abs < 1e-9) ? rounded.toExponential(6) : String(rounded)
  if (out === '-0') out = '0'
  return out.replace(/^-/, '−')
}
