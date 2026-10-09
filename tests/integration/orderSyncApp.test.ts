import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { DirectSource } from '../../src/platform/filesystem/direct'
import type { DirectoryHandle } from '../../src/platform/filesystem/types'
import { activeLibrary, activeSession, createPlaylist, history, loadPlaylist, persistNow, reorderEntries, sources, useApp } from '../../src/app/store'
import { createSyncedPlaylist, disableOrderSync, recoverSync, removeFilenameNumbers, syncBusy } from '../../src/app/orderSync'
import { JOURNAL_PATH, planNumberRemoval } from '../../src/domain/orderSync'
import { equalBytes } from '../../src/platform/filesystem/saveProtocol'
import { loadLibraries, loadSyncJournal } from '../../src/platform/persistence/database'
import { usePlayer } from '../../src/playback/player'
import type { Track } from '../../src/domain/models'

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

describe('removing filename numbers in app state', () => {
  const review = () => planNumberRemoval(activeLibrary()!.tracks, '', activeLibrary()!.files, 'preview')
  const addFile = (files: Map<string, File>, path: string, text: string) => {
    files.set(path, new NativeFile([text], path) as unknown as File)
    useApp.setState(state => ({ libraries: state.libraries.map(library => ({ ...library, files: [...files.keys()], playlists: [...files.keys()].filter(path => /\.m3u8?$/.test(path)) })) }))
  }
  it('saves a queued playlist order, repairs duplicates and lyrics, preserves IDs and history, then stops numbering', async () => {
    const t = fixture(true)
    addFile(t.files, '01 - Alpha.lrc', '[00:00]Hello\n')
    addFile(t.files, 'Other.m3u8', '#EXTM3U\r\n#keep\r\n01 - Alpha.wav\r\n01 - Alpha.wav\r\n')
    await createSyncedPlaylist('Both', '', 'both', ['t0', 't1', 't2']); await settled()
    reorderEntries(new Set([activeSession()!.entries[0].id]), 3)
    await removeFilenameNumbers('lib', '', review())
    expect(activeSession()?.sync).toBeUndefined()
    expect(activeSession()?.entries.map(entry => [entry.trackId, entry.path])).toEqual([['t1', 'Beta.wav'], ['t2', 'Gamma.wav'], ['t0', 'Alpha.wav']])
    expect(await t.files.get('Both.m3u8')!.text()).toBe('#EXTM3U\nBeta.wav\nGamma.wav\nAlpha.wav\n')
    expect(await t.files.get('Other.m3u8')!.text()).toBe('#EXTM3U\r\n#keep\r\nAlpha.wav\r\nAlpha.wav\r\n')
    expect(await t.files.get('Alpha.lrc')!.text()).toBe('[00:00]Hello\n')
    for (const [i, name] of ['Alpha', 'Beta', 'Gamma'].entries()) {
      expect(await t.files.get(`${name}.wav`)!.text()).toBe(`recording-${i}`)
      expect(activeLibrary()?.tracks[`t${i}`].index).toBeNull()
    }
    history('undo')
    expect(activeSession()?.entries.map(entry => entry.path)).toEqual(['Alpha.wav', 'Beta.wav', 'Gamma.wav'])
    expect([...t.files.keys()].filter(path => path.endsWith('.wav'))).toEqual(['Alpha.wav', 'Beta.wav', 'Gamma.wav'])
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
    expect(await loadSyncJournal('lib')).toBeUndefined()
  })
  it('keeps filename-only order as a real unsaved draft without creating a phantom playlist', async () => {
    const t = fixture(true)
    await createSyncedPlaylist('Folder', '', 'filenames', ['t0', 't1', 't2']); await settled()
    await removeFilenameNumbers('lib', '', review())
    expect(activeSession()?.sync).toBeUndefined()
    expect(activeSession()?.document?.path).toMatch(/\.m3u8$/)
    expect(activeSession()?.baseline).toBeNull()
    expect(activeSession()?.status).toBe('dirty')
    expect([...t.files.keys()].some(path => /\.m3u8$/.test(path))).toBe(false)
  })
  it('works without filename sync and maps ordinary drafts, duplicates and undo history', async () => {
    const t = fixture(true)
    addFile(t.files, 'Existing.m3u8', '#EXTM3U\n02 - Beta.wav\n01 - Alpha.wav\n01 - Alpha.wav\n')
    await loadPlaylist('Existing.m3u8')
    createPlaylist('Draft', ['01 - Alpha.wav', '02 - Beta.wav'])
    reorderEntries(new Set([activeSession()!.entries[0].id]), 2)
    await removeFilenameNumbers('lib', '', review())
    expect(activeSession()?.entries.map(entry => entry.path)).toEqual(['Beta.wav', 'Alpha.wav'])
    history('undo')
    expect(activeSession()?.entries.map(entry => entry.path)).toEqual(['Alpha.wav', 'Beta.wav'])
    expect(activeLibrary()?.sessions['Existing.m3u8'].entries.map(entry => entry.path)).toEqual(['Beta.wav', 'Alpha.wav', 'Alpha.wav'])
    expect(await t.files.get('Existing.m3u8')!.text()).toBe('#EXTM3U\nBeta.wav\nAlpha.wav\nAlpha.wav\n')
  })
  it('blocks duplicate restored names before touching files', async () => {
    const t = fixture()
    await expect(removeFilenameNumbers('lib', '', [])).rejects.toThrow(/duplicate filenames/)
    expect(t.source.moveFile).not.toHaveBeenCalled()
    expect(t.source.probeRename).not.toHaveBeenCalled()
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
  })
  it.each(['permission', 'unsupported rename', 'changed audio', 'added audio', 'new lyric', 'disk-backed playback'])('preserves files when blocked by %s', async reason => {
    const t = fixture(true), reviewed = review()
    if (reason === 'permission') t.source.requestAccess = async () => false
    if (reason === 'unsupported rename') t.source.probeRename = async () => { throw new Error('Native rename is unsupported') }
    if (reason === 'changed audio') t.files.set('01 - Alpha.wav', new NativeFile(['edited audio'], '01 - Alpha.wav') as unknown as File)
    if (reason === 'added audio') t.files.set('New.wav', new NativeFile(['new'], 'New.wav') as unknown as File)
    if (reason === 'new lyric') t.files.set('01 - Alpha.lrc', new NativeFile(['new'], '01 - Alpha.lrc') as unknown as File)
    if (reason === 'disk-backed playback') usePlayer.setState({ current: 't0', context: { libraryId: 'lib', kind: 'library' }, renameSafe: false })
    await expect(removeFilenameNumbers('lib', '', reviewed)).rejects.toThrow()
    expect(t.source.moveFile).not.toHaveBeenCalled()
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
    expect(useApp.getState().busy).toBe(false)
  })
  it.each([true, false])('recovers interrupted removal with stable IDs (sync owner: %s)', async synced => {
    const t = fixture(true)
    if (synced) { await createSyncedPlaylist('Both', '', 'both', ['t0', 't1', 't2']); await settled() }
    const move = t.source.moveFile.bind(t.source)
    t.source.moveFile = async (from, to) => { await move(from, to); throw new Error('Interrupted removal') }
    await expect(removeFilenameNumbers('lib', '', review())).rejects.toThrow('Interrupted removal')
    expect(activeLibrary()?.syncRecovery).toBeTruthy()
    expect((await loadSyncJournal('lib'))?.operation).toBe('remove-prefixes')
    t.source.moveFile = move
    await recoverSync('lib')
    expect(Object.keys(activeLibrary()!.tracks)).toEqual(['t0', 't1', 't2'])
    expect(activeLibrary()?.tracks.t0.path).toBe('Alpha.wav')
    expect(activeSession()?.sync).toBeUndefined()
    expect(activeLibrary()?.syncRecovery).toBeUndefined()
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
    expect(await loadSyncJournal('lib')).toBeUndefined()
  })
  it('recovers journal cleanup after removal has already disabled sync', async () => {
    const t = fixture(true)
    await createSyncedPlaylist('Both', '', 'both', ['t0', 't1', 't2']); await settled()
    t.source.removeJournal = async () => { throw new Error('Cleanup failed') }
    await expect(removeFilenameNumbers('lib', '', review())).rejects.toThrow('Cleanup failed')
    const saved = (await loadLibraries())[0]
    useApp.setState({ libraries: [{ ...saved, connected: true }], activeLibrary: saved.id })
    t.source.removeJournal = async () => { t.files.delete(JOURNAL_PATH) }
    await recoverSync('lib')
    expect(activeSession()?.sync).toBeUndefined()
    expect(activeLibrary()?.tracks.t0.path).toBe('Alpha.wav')
    expect(activeLibrary()?.syncRecovery).toBeUndefined()
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
  })
  it('leaves another folder and its paused sync intact during removal recovery', async () => {
    const t = fixture(true)
    const path = 'Other/01 - Elsewhere.wav', file = new NativeFile(['other recording'], path, { lastModified: 1 }) as unknown as File
    t.files.set(path, file)
    useApp.setState(state => ({ libraries: state.libraries.map(library => ({ ...library, files: [...t.files.keys()], tracks: { ...library.tracks, other: { ...library.tracks.t0, id: 'other', path, filename: '01 - Elsewhere.wav', size: file.size, lastModified: file.lastModified } }, sessions: { other: { id: 'other', name: 'Other folder', entries: [], saved: [], baseline: null, undo: [], redo: [], revision: 0, status: 'saved', sync: { mode: 'filenames', folder: 'Other', enabled: false, status: 'paused', committedRevision: 0, stems: { other: 'Elsewhere' } } } } })) }))
    await createSyncedPlaylist('Both', '', 'both', ['t0', 't1', 't2']); await settled()
    const move = t.source.moveFile.bind(t.source)
    t.source.moveFile = async (from, to) => { await move(from, to); throw new Error('Interrupted root removal') }
    await expect(removeFilenameNumbers('lib', '', review())).rejects.toThrow('Interrupted root removal')
    expect(activeLibrary()?.sessions.other.sync?.status).toBe('paused')
    t.source.moveFile = move
    await recoverSync('lib')
    expect(activeLibrary()?.sessions.other.sync?.status).toBe('paused')
    expect(activeLibrary()?.tracks.other.path).toBe(path)
    expect(await t.files.get(path)!.text()).toBe('other recording')
    expect(activeSession()?.sync).toBeUndefined()
  })
  it('blocks an externally edited open dependent playlist before moving audio', async () => {
    const t = fixture(true)
    addFile(t.files, 'Existing.m3u8', '#EXTM3U\n01 - Alpha.wav\n')
    await loadPlaylist('Existing.m3u8')
    t.files.set('Existing.m3u8', new NativeFile(['#EXTM3U\n01 - Alpha.wav\n01 - Alpha.wav\n'], 'Existing.m3u8') as unknown as File)
    await expect(removeFilenameNumbers('lib', '', review())).rejects.toThrow(/reconciliation/)
    expect(t.source.moveFile).not.toHaveBeenCalled()
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
  })
})
afterEach(async () => { await persistNow(); sources.clear(); vi.restoreAllMocks() })
describe('filename-sync app state', () => {
  it('blocks externally changed audio before starting any native rename', async () => {
    const t = fixture()
    await createSyncedPlaylist('Both', '', 'both', ['t0', 't1', 't2']); await settled()
    vi.mocked(t.source.moveFile).mockClear()
    const path = '01 - Same.wav'
    t.files.set(path, new NativeFile(['external recording edit'], path, { lastModified: 999 }) as unknown as File)
    reorderEntries(new Set([activeSession()!.entries[0].id]), 3)
    await vi.waitFor(() => expect(activeSession()?.sync?.status).toBe('error'))
    expect(activeSession()?.sync?.error).toContain('audio file changed outside Meloark')
    expect(t.source.moveFile).not.toHaveBeenCalled()
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
    expect(await t.files.get(path)!.text()).toBe('external recording edit')
  })
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
