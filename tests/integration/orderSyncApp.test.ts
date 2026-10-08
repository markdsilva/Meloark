import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { DirectSource } from '../../src/platform/filesystem/direct'
import type { DirectoryHandle } from '../../src/platform/filesystem/types'
import { activeLibrary, activeSession, history, persistNow, reorderEntries, sources, useApp } from '../../src/app/store'
import { createSyncedPlaylist, disableOrderSync, recoverSync, syncBusy } from '../../src/app/orderSync'
import { JOURNAL_PATH } from '../../src/domain/orderSync'
import { equalBytes } from '../../src/platform/filesystem/saveProtocol'
import { loadLibraries, loadSyncJournal } from '../../src/platform/persistence/database'
import { usePlayer } from '../../src/playback/player'
import type { Track } from '../../src/domain/models'

function fixture() {
  const files = new Map<string, File>(['01', '02', '03'].map((prefix, i) => {
    const path = `${prefix} - Same.wav`
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
afterEach(async () => { await persistNow(); sources.clear(); vi.restoreAllMocks() })
describe('filename-sync app state', () => {
  it('owns no phantom M3U8 in filename-only mode and preserves stable IDs through Undo/Redo', async () => {
    const t = fixture()
    await createSyncedPlaylist('Folder order', '', 'filenames', ['t0', 't1', 't2'])
    await settled()
    expect(activeSession()?.document).toBeUndefined()
    expect(activeLibrary()?.playlists).toEqual([])
    reorderEntries(new Set([activeSession()!.entries[0].id]), 3)
    await settled()
    expect(activeSession()?.entries.map(entry => entry.trackId)).toEqual(['t1', 't2', 't0'])
    expect(await t.files.get('03 - Same.wav')!.text()).toBe('recording-0')
    history('undo'); await settled()
    expect(await t.files.get('01 - Same.wav')!.text()).toBe('recording-0')
    history('redo'); await settled()
    expect(await t.files.get('03 - Same.wav')!.text()).toBe('recording-0')
    expect(Object.keys(activeLibrary()!.tracks)).toEqual(['t0', 't1', 't2'])
    expect([...t.files.keys()].some(path => /\.m3u8$/.test(path))).toBe(false)
    expect(disableOrderSync()).toBe(true)
    expect(activeSession()?.document?.path).toMatch(/\.m3u8$/)
  })
  it('coalesces a newer order while a batch is running without dropping that edit', async () => {
    const t = fixture()
    await createSyncedPlaylist('Both', '', 'both', ['t0', 't1', 't2']); await settled()
    const move = t.source.moveFile.bind(t.source)
    let unblock!: () => void
    const gate = new Promise<void>(resolve => { unblock = resolve })
    let blocked = false
    t.source.moveFile = async (from, to) => { if (!blocked) { blocked = true; await gate }; await move(from, to) }
    reorderEntries(new Set([activeSession()!.entries[0].id]), 3)
    await vi.waitFor(() => expect(blocked).toBe(true))
    expect(syncBusy('lib')).toBe(true)
    reorderEntries(new Set([activeSession()!.entries[0].id]), 3)
    unblock(); await settled()
    expect(activeSession()?.entries.map(entry => entry.trackId)).toEqual(['t2', 't0', 't1'])
    expect(await t.files.get('01 - Same.wav')!.text()).toBe('recording-2')
    expect(await t.files.get('02 - Same.wav')!.text()).toBe('recording-0')
    expect(await t.files.get('03 - Same.wav')!.text()).toBe('recording-1')
    expect(await t.files.get('Both.m3u8')!.text()).toBe('#EXTM3U\n01 - Same.wav\n02 - Same.wav\n03 - Same.wav\n')
  })
  it('does not apply a swap twice if cleanup fails after the saved state commits', async () => {
    const t = fixture()
    await createSyncedPlaylist('Both', '', 'both', ['t0', 't1', 't2']); await settled()
    let fail = true
    t.source.removeJournal = async () => { if (fail) throw new Error('Cleanup failed'); t.files.delete(JOURNAL_PATH) }
    reorderEntries(new Set([activeSession()!.entries[0].id]), 2)
    await vi.waitFor(() => expect(activeSession()?.sync?.status).toBe('recovery'))
    const saved = (await loadLibraries())[0]
    expect(saved.syncAppliedToken).toBeTruthy()
    // Simulate restored persisted app state with a disk journal still present.
    useApp.setState({ libraries: [{ ...saved, connected: true }], activeLibrary: saved.id })
    fail = false
    await recoverSync('lib')
    expect(activeSession()?.entries.map(entry => [entry.trackId, entry.path])).toEqual([['t1', '01 - Same.wav'], ['t0', '02 - Same.wav'], ['t2', '03 - Same.wav']])
    expect(activeLibrary()?.tracks.t0.path).toBe('02 - Same.wav')
    expect(await t.files.get('02 - Same.wav')!.text()).toBe('recording-0')
    expect(activeSession()?.sync?.status).toBe('synced')
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
    expect(await loadSyncJournal('lib')).toBeUndefined()
  })
})
