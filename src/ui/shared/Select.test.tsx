import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { Select } from './Select'

const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', disabled: true, reason: 'Missing tracks' }, { value: 'c', label: 'Charlie' }]
function Example() {
  const [value, change] = useState('a')
  return <><Select label="Playlist source" value={value} onChange={change} options={options} /><button>Next field</button></>
}
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn() })
it('skips disabled choices, selects with the keyboard, and leaves Tab navigation intact', async () => {
  const user = userEvent.setup(); render(<Example />)
  const select = screen.getByRole('combobox', { name: 'Playlist source' })
  select.focus(); await user.keyboard('{ArrowDown}{ArrowDown}')
  expect(select).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Charlie' }).id)
  await user.keyboard('{Enter}')
  expect(select).toHaveAttribute('data-value', 'c'); expect(select).toHaveFocus()
  await user.click(select); await user.tab()
  expect(screen.getByRole('button', { name: 'Next field' })).toHaveFocus()
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})
it('supports typeahead, exposes disabled reasons and consumes Escape only while open', async () => {
  const user = userEvent.setup(), escaped = vi.fn()
  render(<div onKeyDown={event => { if (event.key === 'Escape') escaped() }}><Example /></div>)
  const select = screen.getByRole('combobox'); select.focus(); await user.keyboard('c')
  expect(select).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Charlie' }).id)
  const disabled = screen.getByRole('option', { name: /Beta/ })
  expect(disabled).toHaveAttribute('aria-disabled', 'true'); await user.click(disabled)
  expect(select).toHaveAttribute('data-value', 'a')
  await user.keyboard('{Escape}'); expect(escaped).not.toHaveBeenCalled(); expect(select).toHaveFocus()
  await user.keyboard('{Escape}'); expect(escaped).toHaveBeenCalledOnce()
})
it('uses a native picker for coarse pointers and retains controlled selection', () => {
  const original = window.matchMedia
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  try {
    render(<Example />)
    const select = screen.getByRole('combobox')
    expect(select.tagName).toBe('SELECT'); fireEvent.change(select, { target: { value: 'c' } })
    expect(select).toHaveValue('c'); expect(select).toHaveAttribute('data-value', 'c')
  } finally { window.matchMedia = original }
})
