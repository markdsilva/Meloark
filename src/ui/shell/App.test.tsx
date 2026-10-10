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
    expect(screen.getByRole('heading', { name: /A home for your.*local music/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a music folder' })).toBeEnabled()
    expect(screen.getByText('Music stays local')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Play$/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Browser support' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Help & browser support')
    expect(screen.getByRole('heading', { name: /^Available$/ })).toBeInTheDocument()
  })
})
