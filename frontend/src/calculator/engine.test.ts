import { describe, expect, it } from 'vitest'
import { display, evaluate, initialState, press, type Key } from './engine'

const type = (keys: Key[]) => keys.reduce(press, initialState)

describe('evaluate', () => {
  it('respects precedence', () => {
    expect(evaluate('2+3×4')).toBe('14')
    expect(evaluate('10−4÷2')).toBe('8')
  })
  it('handles decimals without float noise', () => {
    expect(evaluate('0.1+0.2')).toBe('0.3')
  })
  it('handles unary minus and percent', () => {
    expect(evaluate('−5×−2')).toBe('10')
    expect(evaluate('50%×200')).toBe('100')
  })
  it('reports division by zero as Error', () => {
    expect(evaluate('7÷0')).toBe('Error')
  })
  it('ignores a trailing operator', () => {
    expect(evaluate('9+')).toBe('9')
  })
})

describe('press', () => {
  it('builds and evaluates an expression', () => {
    const s = type(['1', '2', '+', '3', '='])
    expect(display(s)).toBe('15')
    expect(s.justEvaluated).toBe(true)
  })
  it('starts a fresh number after a result', () => {
    expect(display(type(['2', '×', '3', '=', '7']))).toBe('7')
  })
  it('chains an operator onto a result', () => {
    expect(display(type(['2', '×', '3', '=', '+', '1', '=']))).toBe('7')
  })
  it('replaces a repeated operator', () => {
    expect(display(type(['5', '+', '×']))).toBe('5×')
  })
  it('allows a negative operand after × or ÷', () => {
    expect(display(type(['5', '×', '−', '2', '=']))).toBe('−10')
  })
  it('rejects a second decimal point', () => {
    expect(display(type(['1', '.', '5', '.', '2']))).toBe('1.52')
  })
  it('toggles the sign of the last number', () => {
    expect(display(type(['8', '−', '3', '±']))).toBe('8−−3')
    expect(display(type(['8', '−', '3', '±', '±']))).toBe('8−3')
  })
  it('backspace and clear', () => {
    expect(display(type(['1', '2', '3', '⌫']))).toBe('12')
    expect(display(type(['1', '2', 'AC']))).toBe('0')
  })
  it('collapses leading zeros', () => {
    expect(display(type(['0', '0', '7']))).toBe('7')
  })
})
