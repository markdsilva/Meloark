import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { CreatePlaylist } from '../../src/ui/playlist/CreatePlaylist'
import { activeLibrary, activeSession, loadPlaylist, persistNow, reorderEntries, sources, useApp } from '../../src/app/store'
import { DirectSource } from '../../src/platform/filesystem/direct'
import type { DirectoryHandle } from '../../src/platform/filesystem/types'

const path = 'Different name.m3u8'
const original = '#EXTM3U\n03 - Gamma.wav\n01 - Alpha.wav\n02 - Beta.wav\n'
function fixture(extra?: string) {
  const files = new Map<string, File>([[path, new NativeFile([original], path) as unknown as File]])
  if (extra) files.set(extra, new NativeFile([original], extra) as unknown as File)
  const tracks = Object.fromEntries(['Alpha', 'Beta', 'Gamma'].map((name, i) => {
    const path = `0${i + 1} - ${name}.wav`
    files.set(path, new NativeFile([name], path) as unknown as File)
    return [`t${i}`, { id: `t${i}`, path, filename: path, index: i + 1, size: name.length, lastModified: 1, metadataStatus: 'ready' as const, metadata: { title: name, artist: '', album: '' }, support: 'likely' as const }]
  }))
  const source = new DirectSource({ name: 'Music' } as DirectoryHandle)
  source.readFresh = async name => files.get(name) ?? null
  source.readFile = async name => { const file = files.get(name); if (!file) throw new Error('Missing'); return file }
  useApp.setState({ libraries: [{ id: 'lib', name: 'Music', kind: 'direct', connected: true, scanning: false, generation: 1, tracks, files: [...files.keys()], playlists: extra ? [path, extra] : [path], sessions: {} }], activeLibrary: 'lib', ready: true, busy: false })
  sources.set('lib', source)
  return { files, source }
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, run: () => Promise<unknown>) => run() } })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(async () => { await persistNow(); sources.clear() })
describe('playlist order setup choices', () => {
  it('recommends a differently named existing playlist and opens it without creating or rewriting files', async () => {
    const t = fixture(), close = vi.fn()
    render(createElement(CreatePlaylist, { setup: true, close }))
    await waitFor(() => expect(screen.getByLabelText('Playlist file')).toHaveValue(path))
    expect(activeSession()).toBeUndefined()
    expect(screen.getByText(/Saved playlist and filename order differ/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use existing playlist' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(activeSession()?.entries.map(entry => entry.trackId)).toEqual(['t2', 't0', 't1'])
    expect(await t.files.get(path)!.text()).toBe(original)
    expect(activeLibrary()?.playlists).toEqual([path])
  })
  it('requires an explicit order when filenames disagree and clears rename confirmation on another choice', async () => {
    fixture()
    render(createElement(CreatePlaylist, { setup: true, close: vi.fn() }))
    await waitFor(() => expect(screen.getByLabelText('Playlist file')).toHaveValue(path))
    fireEvent.click(screen.getByRole('radio', { name: /Numbered filenames \+ M3U8/ }))
    const checkbox = screen.getByLabelText('I reviewed this folder and order and want automatic file renaming.')
    expect(checkbox).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Use saved M3U8 order/ }))
    fireEvent.click(checkbox)
    expect(screen.getByRole('button', { name: 'Set up playlist' })).toBeEnabled()
    fireEvent.click(screen.getByRole('radio', { name: /Use filename order/ }))
    expect(checkbox).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Set up playlist' })).toBeDisabled()
  })
  it('requires selecting a source when multiple compatible playlists exist', async () => {
    fixture('Another.m3u8')
    render(createElement(CreatePlaylist, { setup: true, close: vi.fn() }))
    await waitFor(() => expect(screen.getByLabelText('Playlist source')).toHaveAttribute('data-value', '@choose'))
    expect(screen.getByRole('button', { name: 'Set up playlist' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Playlist source'))
    fireEvent.click(screen.getByRole('option', { name: 'Create a new M3U8' }))
    expect(screen.getByRole('button', { name: 'Set up playlist' })).toBeEnabled()
  })
  it('distinguishes a saved file order from an unsaved draft without changing the active session while selecting', async () => {
    fixture(); await loadPlaylist(path)
    reorderEntries(new Set([activeSession()!.entries[0].id]), 3)
    const before = activeSession()
    render(createElement(CreatePlaylist, { setup: true, close: vi.fn() }))
    await waitFor(() => expect(screen.getByLabelText('Playlist file')).toHaveValue(path))
    expect(screen.getByRole('button', { name: 'Use existing playlist' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Use current draft order/ }))
    expect(screen.getByRole('button', { name: 'Use existing playlist' })).toBeEnabled()
    expect(activeSession()).toBe(before)
  })
  it('disables a selected source when reading its file fails on reinspection', async () => {
    const t = fixture()
    render(createElement(CreatePlaylist, { setup: true, close: vi.fn() }))
    await waitFor(() => expect(screen.getByLabelText('Playlist file')).toHaveValue(path))
    t.source.readFresh = async () => { throw new Error('File permission expired') }
    fireEvent.click(screen.getByRole('button', { name: 'Read playlists again' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('File permission expired'))
    expect(screen.getByRole('button', { name: 'Use existing playlist' })).toBeDisabled()
    expect(activeSession()).toBeUndefined()
  })
  it('does not require a new playlist name when reusing an existing file', async () => {
    fixture()
    render(createElement(CreatePlaylist, { close: vi.fn() }))
    await waitFor(() => expect(screen.getByLabelText('Playlist source')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Playlist name'), {target:{value:''}})
    fireEvent.click(screen.getByLabelText('Playlist source'))
    fireEvent.click(screen.getByRole('option', { name: path }))
    expect(screen.getByRole('button', {name:'Use existing playlist'})).toBeEnabled()
  })
  it('explains incompatible playlists and prevents using a subset as a filename-sync authority', async () => {
    const t = fixture()
    t.files.set(path, new NativeFile(['#EXTM3U\n01 - Alpha.wav\n'], path) as unknown as File)
    render(createElement(CreatePlaylist, { close: vi.fn() }))
    await waitFor(() => expect(screen.getByRole('radio', { name: /Numbered filenames \+ M3U8/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('radio', { name: /Numbered filenames \+ M3U8/ }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Initial sync order' }))
    const option = screen.getByRole('option', { name: /Different name.m3u8/ })
    expect(option).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(option)
    expect(screen.getByRole('combobox', { name: 'Initial sync order' })).toHaveAttribute('data-value', '')
    expect(screen.getByText(/Filename sync requires every track/)).toBeInTheDocument()
  })
})
