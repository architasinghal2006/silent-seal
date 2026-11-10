// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import SafetyApp from '../layouts/SafetyApp'
import { api, clearToken } from '../services/api'
import { createFakeServer, REAL_PIN, USER } from '../test/fakeServer'

let server: ReturnType<typeof createFakeServer>

beforeEach(async () => {
  server = createFakeServer()
  clearToken()
  await api.unlock(USER, REAL_PIN)
})

function open(offline = false) {
  render(<SafetyApp initialPath="/contacts" session={{ offline, demo: false, lock: () => undefined, wipe: () => undefined }} />)
}

describe('trusted contacts', () => {
  it('lists each contact with relationship, destination and emergency status', async () => {
    open()
    const card = (await screen.findByText('Asha Verma')).closest('li')!
    expect(within(card).getByText('Sister')).toBeInTheDocument()
    expect(within(card).getByText('+919800000001')).toBeInTheDocument()
    expect(within(card).getByText('Emergency')).toBeInTheDocument()
  })

  it('adds an email contact who is not alerted', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Add a contact' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a trusted contact' })
    await user.type(within(dialog).getByLabelText('Name'), 'Meera Nair')
    await user.type(within(dialog).getByLabelText('Relationship'), 'Friend')
    await user.selectOptions(within(dialog).getByLabelText('Send alerts by'), 'email')
    await user.type(within(dialog).getByLabelText('Email address'), 'meera@example.org')
    await user.click(within(dialog).getByRole('switch', { name: 'Emergency contact' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save contact' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.calls('POST', '/contacts')[0].body).toEqual({
      name: 'Meera Nair',
      relationship: 'Friend',
      channel: 'email',
      phone: null,
      email: 'meera@example.org',
      is_emergency: false,
    })
    const card = screen.getByText('Meera Nair').closest('li')!
    expect(within(card).getByText('Not alerted')).toBeInTheDocument()
  })

  it('refuses a bad phone number and sends nothing', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Add a contact' }))
    await user.type(screen.getByLabelText('Name'), 'Kavita')
    await user.type(screen.getByLabelText('Phone number'), '12345')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a phone number with country code')
    expect(server.calls('POST', '/contacts')).toHaveLength(0)
  })

  it('edits a contact in place', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Edit Asha Verma' }))
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Asha V')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(await screen.findByText('Asha V')).toBeInTheDocument()
    expect(server.calls('PUT', '/contacts/c1')[0].body.name).toBe('Asha V')
    expect(screen.queryByText('Asha Verma')).not.toBeInTheDocument()
  })

  it('removes a contact only after confirming', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Remove Asha Verma' }))
    expect(server.calls('DELETE', '/contacts/c1')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Asha Verma')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Asha Verma' }))
    await user.click(screen.getByRole('button', { name: 'Remove contact' }))
    expect(await screen.findByText('No trusted contacts yet')).toBeInTheDocument()
    expect(server.calls('DELETE', '/contacts/c1')).toHaveLength(1)
  })

  it('keeps the contact and says so when removing fails', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Remove Asha Verma' }))
    server.state.online = false
    await user.click(screen.getByRole('button', { name: 'Remove contact' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove that contact')
    expect(screen.getByText('Asha Verma')).toBeInTheDocument()
  })

  it('explains itself instead of loading when unlocked offline', async () => {
    open(true)
    expect(await screen.findByText(/can’t be shown or changed without a connection/)).toBeInTheDocument()
    expect(server.calls('GET', '/contacts')).toHaveLength(0)
  })
})
