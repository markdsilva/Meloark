import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { useApp } from '../../app/store'

beforeEach(() => {
  useApp.setState({ libraries: [], activeLibrary: undefined, ready: true, busy: false, notice: undefined, storageError: undefined, view: 'library' })
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') })
})
describe('workspace shell', () => {
  it('offers portable selection and privacy information without gating the app', async () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /Your music.*At home/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a music folder' })).toBeEnabled()
    expect(screen.getByText('No uploads. No account. Just your library.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Play$/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'See capabilities' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Your browser, your library')
    expect(screen.getByText('No music uploads')).toBeInTheDocument()
  })
})
