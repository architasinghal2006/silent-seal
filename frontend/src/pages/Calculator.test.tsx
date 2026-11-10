// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { saveSequence } from '../crypto/sequence'
import { Calculator } from './Calculator'

const NAMES: Record<string, string> = { '=': 'Equals', '+': 'Add', '−': 'Subtract', '×': 'Multiply', '÷': 'Divide', '.': 'Decimal point', C: 'Clear' }

async function tap(keys: string) {
  const user = userEvent.setup()
  for (const key of keys) await user.click(screen.getByRole('button', { name: NAMES[key] ?? key }))
}

const shown = () => screen.getByTestId('display').textContent?.replace('M', '')
const inPinMode = () => screen.getByTestId('memory').textContent === 'M'

function setup(props: Partial<Parameters<typeof Calculator>[0]> = {}) {
  const onSetupRequested = vi.fn()
  const onPinAttempt = vi.fn(async () => false)
  render(<Calculator hasAccount onSetupRequested={onSetupRequested} onPinAttempt={onPinAttempt} {...props} />)
  return { onSetupRequested, onPinAttempt: (props.onPinAttempt as typeof onPinAttempt) ?? onPinAttempt }
}

describe('as a calculator', () => {
  it('does arithmetic with precedence and decimals', async () => {
    setup()
    await tap('12+3×4=')
    expect(shown()).toBe('24')
    await tap('C1.5+2.25=')
    expect(shown()).toBe('3.75')
    await tap('C9−10=')
    expect(shown()).toBe('−1')
  })

  it('shows an error for division by zero and recovers', async () => {
    setup()
    await tap('8÷0=')
    expect(shown()).toBe('Error')
    await tap('C2+2=')
    expect(shown()).toBe('4')
  })

  it('works from the keyboard, including delete', async () => {
    setup()
    for (const key of ['7', '*', '6', '5', 'Backspace', 'Enter']) fireEvent.keyDown(window, { key })
    await waitFor(() => expect(shown()).toBe('42'))
  })

  it('needs no account and never asks for one during ordinary sums', async () => {
    const { onSetupRequested, onPinAttempt } = setup({ hasAccount: false })
    await tap('1378=')
    await tap('C2580=')
    expect(onSetupRequested).not.toHaveBeenCalled()
    expect(onPinAttempt).not.toHaveBeenCalled()
    expect(inPinMode()).toBe(false)
  })
})

describe('the secret sequence', () => {
  it('opens first-time setup on a phone with no account', async () => {
    const { onSetupRequested } = setup({ hasAccount: false })
    await tap('1379=')
    await waitFor(() => expect(onSetupRequested).toHaveBeenCalledOnce())
  })

  it('enters PIN mode with only a small M, and still shows the sum', async () => {
    setup()
    await tap('1379=')
    await waitFor(() => expect(inPinMode()).toBe(true))
    expect(shown()).toBe('1379')
    expect(screen.queryByText(/pin|unlock|password/i)).not.toBeInTheDocument()
  })

  it('uses the survivor’s own sequence once chosen, and the default stops working', async () => {
    await saveSequence('2580')
    setup()
    await tap('1379=')
    expect(inPinMode()).toBe(false)
    await tap('C2580=')
    await waitFor(() => expect(inPinMode()).toBe(true))
  })

  it('is not triggered as part of a longer sum', async () => {
    setup()
    await tap('1379+1=')
    expect(inPinMode()).toBe(false)
    expect(shown()).toBe('1380')
  })
})

describe('PIN entry', () => {
  it('passes the typed PIN, with leading zeros, and clears the display on success', async () => {
    const onPinAttempt = vi.fn(async () => true)
    setup({ onPinAttempt })
    await tap('1379=')
    await tap('0123=')
    await waitFor(() => expect(onPinAttempt).toHaveBeenCalledWith('0123'))
    await waitFor(() => expect(shown()).toBe('0'))
    expect(inPinMode()).toBe(false)
  })

  it('shows a wrong PIN as an ordinary result, with no error', async () => {
    const { onPinAttempt } = setup()
    await tap('1379=')
    await tap('9999=')
    await waitFor(() => expect(onPinAttempt).toHaveBeenCalledWith('9999'))
    expect(shown()).toBe('9999')
    expect(inPinMode()).toBe(false)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not try a PIN that is too short', async () => {
    const { onPinAttempt } = setup()
    await tap('1379=')
    await tap('12=')
    expect(onPinAttempt).not.toHaveBeenCalled()
    expect(shown()).toBe('12')
  })

  it('leaves PIN mode as soon as an operator is pressed', async () => {
    const { onPinAttempt } = setup()
    await tap('1379=')
    await tap('24+68=')
    expect(onPinAttempt).not.toHaveBeenCalled()
    expect(shown()).toBe('92')
  })

  it('loses no key when they arrive faster than the checks finish', async () => {
    const onPinAttempt = vi.fn(async () => true)
    setup({ onPinAttempt })
    for (const key of ['1', '3', '7', '9', 'Enter', '2', '4', '6', '8', 'Enter']) fireEvent.keyDown(window, { key })
    await waitFor(() => expect(onPinAttempt).toHaveBeenCalledWith('2468'))
  })
})
