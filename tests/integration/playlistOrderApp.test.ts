import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { DirectSource } from '../../src/platform/filesystem/direct'
import type { DirectoryHandle } from '../../src/platform/filesystem/types'
import { activeLibrary, activeSession, loadPlaylist, persistNow, sources, useApp, reorderEntries } from '../../src/app/store'
import { createSyncedPlaylist, disableOrderSync, reconcileOrderSync, recoverSync, syncBusy } from '../../src/app/orderSync'
import { JOURNAL_PATH } from '../../src/domain/orderSync'
import { equalBytes } from '../../src/platform/filesystem/saveProtocol'
import { usePlayer } from '../../src/playback/player'
import type { Track } from '../../src/domain/models'
import { inspectPlaylistOrder, adoptPlaylistOrder } from '../../src/app/playlistOrder'
function fixture(distinct = false) {
  const files = new Map<string, File>(['01', '02', '03'].map((prefix, i) => {
    const path = `${prefix} - ${distinct ? ['Alpha', 'Beta', 'Gamma'][i] : 'Same'}.wav`
    return [path, new NativeFile([`recording-${i}`], path, { lastModified: i + 1 }) as unknown as File]
  }))
  const tracks = Object.fromEntries([...files].map(([path, file], i) => [`t${i}`, { id: `t${i}`, path, filename: path, size: file.size, lastModified: file.lastModified,
    index: i + 1, support: 'likely', metadataStatus: 'ready', metadata: { title: 'Same', artist: '', album: '' } } satisfies Track]))
  const source = new DirectSource({ name: 'Music' } as DirectoryHandle)
  source.requestAccess = async () => true
  source.getAccess = async () => ({ read: 'granted', write: 'granted', reconnect: false })
  source.probeRename = vi.fn(async () => {})
  source.scan = async function* () { for (const [path, file] of files) if (path !== JOURNAL_PATH) yield { path, reference: path, size: file.size, lastModified: file.lastModified } }
  source.readFresh = async path => files.get(path) ?? null
  source.readFile = async path => { const file = files.get(path); if (!file) throw new Error('Missing file'); return file }
  source.moveFile = vi.fn(async (from, to) => { if (!files.has(from) || files.has(to)) throw new Error('Unsafe move'); files.set(to, files.get(from)!); files.delete(from) })
  source.writeSyncFile = async (path, bytes, expected) => {
    const file = files.get(path), actual = file ? new Uint8Array(await file.arrayBuffer()) : null
    if (actual ? !equalBytes(actual, expected) : expected !== null) throw new Error('Conflict')
    files.set(path, new NativeFile([new Uint8Array(bytes)], path) as unknown as File)
    return { bytes, hash: 'verified' }
  }
  source.removeJournal = async () => { files.delete(JOURNAL_PATH) }
  useApp.setState({ libraries: [{ id: 'lib', name: 'Music', kind: 'direct', connected: true, scanning: false, generation: 1, tracks, files: [...files.keys()], playlists: [], sessions: {} }], activeLibrary: 'lib', ready: true, busy: false })
  sources.set('lib', source)
  return { files, source }
}
const settled = () => vi.waitFor(() => { expect(activeSession()?.sync?.status).toBe('synced'); expect(syncBusy('lib')).toBe(false) }, { timeout: 4000 })
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, run: () => Promise<unknown>) => run() } })
  usePlayer.setState({ current: null, context: undefined })
  sources.clear()
})


const path = 'Road trip.m3u8'
const reversed = '#EXTM3U\n03 - Gamma.wav\n01 - Alpha.wav\n02 - Beta.wav\n'
function addPlaylist(files: Map<string, File>, text = reversed) {
  files.set(path, new NativeFile([text], path) as unknown as File)
  useApp.setState(state => ({ libraries: state.libraries.map(lib => ({ ...lib, files: [...files.keys()], playlists: [path] })) }))
}
const playlistLines = async (files: Map<string, File>, name = path) => (await files.get(name)!.text()).split(/\r?\n/).filter(line => line && !line.startsWith('#'))
afterEach(async () => { await persistNow(); sources.clear(); vi.restoreAllMocks() })
describe('reviewing an existing playlist order', () => {
  it('inspects without opening a playlist or creating sessions, then adopts without writes', async () => {
    const t = fixture(true); addPlaylist(t.files)
    const review = await inspectPlaylistOrder(path, 'lib')
    expect(activeSession()).toBeUndefined(); expect(activeLibrary()?.sessions).toEqual({})
    expect(review.document.entries.map(entry => entry.trackId)).toEqual(['t2', 't0', 't1'])
    await adoptPlaylistOrder(review, 'saved')
    expect(activeSession()?.entries.map(entry => entry.trackId)).toEqual(['t2', 't0', 't1'])
    expect(await t.files.get(path)!.text()).toBe(reversed)
    expect(t.source.moveFile).not.toHaveBeenCalled()
  })
  it.each(['saved', 'filenames'] as const)('uses the explicit %s order and synchronizes an existing differently named M3U8', async choice => {
    const t = fixture(true); addPlaylist(t.files)
    const review = await inspectPlaylistOrder(path, 'lib')
    await createSyncedPlaylist('', '', 'both', ['t0', 't1', 't2'], path, {review, choice}); await settled()
    const expected = choice === 'saved' ? ['01 - Gamma.wav', '02 - Alpha.wav', '03 - Beta.wav'] : ['01 - Alpha.wav', '02 - Beta.wav', '03 - Gamma.wav']
    expect(await playlistLines(t.files)).toEqual(expected)
    expect([...t.files.keys()].filter(name => /\.m3u8$/.test(name))).toEqual([path])
    expect(await t.files.get(expected[0])!.text()).toBe(choice === 'saved' ? 'recording-2' : 'recording-0')
  })
  it('reuses a formerly synced playlist by document path after disabling sync', async () => {
    const t = fixture(true)
    await createSyncedPlaylist('Both', '', 'both', ['t2', 't0', 't1']); await settled()
    const id = activeSession()!.id
    expect(disableOrderSync()).toBe(true)
    await createSyncedPlaylist('Ignored', '', 'both', ['t0', 't1', 't2'], 'Both.m3u8'); await settled()
    expect(activeSession()?.id).toBe(id)
    expect(activeSession()?.entries.map(entry => entry.trackId)).toEqual(['t2', 't0', 't1'])
    expect(await playlistLines(t.files, 'Both.m3u8')).toEqual(['01 - Gamma.wav', '02 - Alpha.wav', '03 - Beta.wav'])
  })
  it('reuses an inspected saved M3U8 whose session originated from a legacy M3U conversion', async () => {
    const t = fixture(true); addPlaylist(t.files); await loadPlaylist(path)
    const converted = { ...activeSession()!, id: 'Legacy.M3U', sourcePath: 'Legacy.M3U' }
    useApp.setState(state => ({ libraries: state.libraries.map(lib => ({ ...lib, sessions: { 'Legacy.M3U': converted }, activePlaylist: 'Legacy.M3U' })) }))
    const review = await inspectPlaylistOrder(path, 'lib')
    await createSyncedPlaylist('', '', 'both', [], path, { review, choice: 'saved' }); await settled()
    expect(activeSession()?.id).toBe('Legacy.M3U')
    expect(await playlistLines(t.files)).toEqual(['01 - Gamma.wav', '02 - Alpha.wav', '03 - Beta.wav'])
  })
  it.each(['saved', 'draft'] as const)('distinguishes saved order from current draft: %s', async choice => {
    const t = fixture(true); addPlaylist(t.files); await loadPlaylist(path)
    reorderEntries(new Set([activeSession()!.entries[0].id]), 3)
    const review = await inspectPlaylistOrder(path, 'lib')
    await createSyncedPlaylist('Ignored', '', 'both', [], path, {review, choice}); await settled()
    expect(activeSession()?.entries.map(entry => entry.trackId)).toEqual(choice === 'saved' ? ['t2', 't0', 't1'] : ['t0', 't1', 't2'])
  })
  it('rejects a stale disk preview before probing or moving audio', async () => {
    const t = fixture(true); addPlaylist(t.files)
    const review = await inspectPlaylistOrder(path, 'lib')
    addPlaylist(t.files, '#EXTM3U\n01 - Alpha.wav\n02 - Beta.wav\n03 - Gamma.wav\n')
    await expect(createSyncedPlaylist('Ignored', '', 'both', [], path, {review, choice:'saved'})).rejects.toThrow('changed since this preview')
    expect(t.source.probeRename).not.toHaveBeenCalled(); expect(t.source.moveFile).not.toHaveBeenCalled()
  })
  it('rejects a changed current draft before adopting a reviewed order', async () => {
    const t = fixture(true); addPlaylist(t.files); await loadPlaylist(path)
    const review = await inspectPlaylistOrder(path, 'lib')
    reorderEntries(new Set([activeSession()!.entries[0].id]), 3)
    await expect(adoptPlaylistOrder(review, 'saved')).rejects.toThrow('current draft changed')
    expect(activeSession()?.entries.map(entry => entry.trackId)).toEqual(['t0', 't1', 't2'])
  })
  it.each([
    '#EXTM3U\n01 - Alpha.wav\n',
    '#EXTM3U\n01 - Alpha.wav\n01 - Alpha.wav\n02 - Beta.wav\n03 - Gamma.wav\n',
    '#EXTM3U\n01 - Alpha.wav\n02 - Beta.wav\nMissing.wav\n',
  ])('rejects incompatible membership before probing native rename', async text => {
    const t = fixture(true); addPlaylist(t.files, text)
    const review = await inspectPlaylistOrder(path, 'lib')
    await expect(createSyncedPlaylist('Ignored', '', 'both', [], path, {review, choice:'saved'})).rejects.toThrow()
    expect(t.source.probeRename).not.toHaveBeenCalled(); expect(t.source.moveFile).not.toHaveBeenCalled()
  })
})

describe('external order reconciliation', () => {
  async function externalFixture() {
    const t = fixture(true); addPlaylist(t.files)
    await createSyncedPlaylist('Both', '', 'both', ['t0', 't1', 't2']); await settled()
    const authority = 'Both.m3u8'
    const text = '#EXTM3U\r\n#changed by another app\r\n03 - Gamma.wav\r\n01 - Alpha.wav\r\n02 - Beta.wav\r\n'
    t.files.set(authority, new NativeFile([text], authority) as unknown as File)
    reorderEntries(new Set([activeSession()!.entries[0].id]), 3)
    await vi.waitFor(() => expect(activeSession()?.sync?.status).toBe('error'), {timeout:4000})
    vi.mocked(t.source.moveFile).mockClear()
    return { ...t, authority, text }
  }
  it.each(['saved', 'draft'] as const)('reconciles using %s order, preserves bytes/IDs and another playlist sequence', async choice => {
    const t = await externalFixture()
    const review = await inspectPlaylistOrder(t.authority, 'lib')
    await reconcileOrderSync(review, choice)
    expect(activeSession()?.sync?.status).toBe('synced')
    const ids = choice === 'saved' ? ['t2', 't0', 't1'] : ['t1', 't2', 't0']
    expect(activeSession()?.entries.map(entry => entry.trackId)).toEqual(ids)
    const expected = choice === 'saved' ? ['01 - Gamma.wav','02 - Alpha.wav','03 - Beta.wav'] : ['01 - Beta.wav','02 - Gamma.wav','03 - Alpha.wav']
    expect(await playlistLines(t.files, t.authority)).toEqual(expected)
    for (const [id, track] of Object.entries(activeLibrary()!.tracks)) expect(await t.files.get(track.path)!.text()).toBe(`recording-${id.slice(1)}`)
    expect(await playlistLines(t.files)).toEqual(choice === 'saved' ? expected : ['02 - Gamma.wav','03 - Alpha.wav','01 - Beta.wav'])
    expect(await t.files.get(t.authority)!.text()).toContain('#changed by another app\r\n')
    expect(Object.keys(activeLibrary()!.tracks)).toEqual(['t0','t1','t2'])
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
  })
  it('rejects another disk edit after review without changing audio or the new file', async () => {
    const t = await externalFixture()
    const review = await inspectPlaylistOrder(t.authority, 'lib')
    const newer = '#EXTM3U\n02 - Beta.wav\n01 - Alpha.wav\n03 - Gamma.wav\n'
    t.files.set(t.authority, new NativeFile([newer], t.authority) as unknown as File)
    await expect(reconcileOrderSync(review, 'saved')).rejects.toThrow('changed since this preview')
    expect(t.source.moveFile).not.toHaveBeenCalled()
    expect(await t.files.get(t.authority)!.text()).toBe(newer)
    expect(activeSession()?.entries.map(entry=>entry.trackId)).toEqual(['t1','t2','t0'])
  })
  it('rejects incomplete external playlists before any native moves', async () => {
    const t = await externalFixture()
    t.files.set(t.authority, new NativeFile(['#EXTM3U\n01 - Alpha.wav\n'], t.authority) as unknown as File)
    const review = await inspectPlaylistOrder(t.authority, 'lib')
    await expect(reconcileOrderSync(review, 'draft')).rejects.toThrow('every audio file')
    expect(t.source.moveFile).not.toHaveBeenCalled()
  })
  it('keeps recoverable journal data if a reconciliation move is interrupted', async () => {
    const t = await externalFixture()
    const review = await inspectPlaylistOrder(t.authority, 'lib')
    const move = t.source.moveFile.bind(t.source)
    t.source.moveFile = async (from, to) => { await move(from, to); throw new Error('Interrupted reconciliation') }
    await expect(reconcileOrderSync(review, 'saved')).rejects.toThrow('Interrupted reconciliation')
    expect(activeLibrary()?.syncRecovery).toBeTruthy()
    expect(t.files.has(JOURNAL_PATH)).toBe(true)
    t.source.moveFile = move
    await recoverSync('lib')
    expect(activeSession()?.sync?.status).toBe('synced')
    expect(await playlistLines(t.files, t.authority)).toEqual(['01 - Gamma.wav','02 - Alpha.wav','03 - Beta.wav'])
    expect(await t.files.get('01 - Gamma.wav')!.text()).toBe('recording-2')
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
  })
})
