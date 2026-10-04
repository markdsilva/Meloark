import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadLibraries, saveLibraries } from '../../src/platform/persistence/database'
import { emptyDocument } from '../../src/playlists/codec'
import { useApp, sources, savePlaylist, createPlaylist, addTracks, removeEntries, history, persistNow } from '../../src/app/store'
import { newId, type PlaylistSession, type Track } from '../../src/domain/models'
import { UnverifiedWriteError } from '../../src/platform/filesystem/saveProtocol'
import { webcrypto } from 'node:crypto'
import type { LibrarySource } from '../../src/platform/filesystem/types'
function setup(failure?: 'write' | 'unverified') {
  const id = newId(), track: Track = { id: 'track', path: 'Song.mp3', filename: 'Song.mp3', size: 10, lastModified: 0, index: null,
    support: 'likely', metadataStatus: 'ready', metadata: { title: 'Song', artist: '', album: '' } }
  useApp.setState({ libraries: [{ id, name: 'Music', kind: 'direct', connected: true, scanning: false, generation: 1, tracks: { track }, playlists: [], files: [track.path], sessions: {} }], activeLibrary: id, busy: false, storageError: undefined })
  const write = vi.fn(async (_target: string, bytes: Uint8Array) => {
    if (failure === 'write') throw new Error('Disk denied')
    if (failure === 'unverified') throw new UnverifiedWriteError('Verification unavailable')
    return { bytes, hash: 'verified' }
  })
  const source = { kind: 'direct', name: 'Music', requestAccess: vi.fn(async () => true), writePlaylist: write } as unknown as LibrarySource
  sources.set(id, source)
  createPlaylist('Listening'); addTracks(['track'])
  return { id, write, source, session: () => useApp.getState().libraries[0].sessions['Listening.m3u8'] }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); sources.clear(); useApp.setState({ busy: false }) })
describe('save state and IndexedDB recovery', () => {
  it('commits saved state only after a verified receipt and retains undo', async () => {
    const t = setup()
    const before = t.session()
    await savePlaylist()
    expect(t.session().status).toBe('saved')
    expect(t.session().saved).toEqual(before.entries)
    expect(t.session().undo).toHaveLength(1)
    history('undo')
    expect(t.session().status).toBe('dirty')
    expect(t.session().baseline).toBeTruthy()
  })
  it.each(['write', 'unverified'] as const)('retains draft and baseline on %s failure', async failure => {
    const t = setup(failure), before = t.session()
    await savePlaylist()
    expect(t.session().baseline).toBe(before.baseline)
    expect(t.session().entries).toEqual(before.entries)
    expect(t.session().status).toBe(failure === 'write' ? 'error' : 'unverified')
    expect(useApp.getState().busy).toBe(false)
  })
  it('does not attempt a write after permission denial', async () => {
    const t = setup()
    t.source.requestAccess = vi.fn(async () => false)
    await savePlaylist()
    expect(t.write).not.toHaveBeenCalled()
    expect(t.session().status).toBe('error')
  })
  it('rejects stale membership before writing and never deletes audio on removal', async () => {
    const t = setup()
    const library = useApp.getState().libraries[0]
    useApp.setState({ libraries: [{ ...library, tracks: {} }] })
    await savePlaylist()
    expect(t.write).not.toHaveBeenCalled()
    removeEntries(new Set(t.session().entries.map(entry => entry.id)))
    expect(t.source).not.toHaveProperty('deleteFile')
    expect(t.session().entries).toHaveLength(0)
  })
  it('restores a portable draft disconnected with fresh history', async () => {
    setup()
    await persistNow()
    const libraries = await loadLibraries()
    const library = libraries.find(l => l.name === 'Music')!
    expect(library.connected).toBe(false)
    expect(library.sessions['Listening.m3u8'].entries).toHaveLength(1)
    expect(library.sessions['Listening.m3u8'].undo).toHaveLength(0)
  })
  it('stores baseline bytes and draft occurrences without audio data', async () => {
    const t = setup()
    await savePlaylist()
    const libraries = await loadLibraries()
    const saved = libraries.find(l => l.id === t.id)!.sessions['Listening.m3u8']
    expect(ArrayBuffer.isView(saved.baseline)).toBe(true)
    expect([...saved.baseline!]).toEqual([...t.session().baseline!])
    expect(saved.entries[0].id).toBe(t.session().entries[0].id)
    expect(libraries[0]).not.toHaveProperty('source')
  })
  it('preserves a verified file save when the browser cache subsequently fails', async () => {
    const t = setup()
    t.source.writePlaylist = async (_target, bytes) => {
      vi.stubGlobal('indexedDB', { open() { throw new Error('QuotaExceededError') } })
      return { bytes, hash: 'verified' }
    }
    await savePlaylist()
    expect(t.session().status).toBe('saved')
    expect(useApp.getState().storageError).toContain('unavailable or full')
    vi.unstubAllGlobals()
  })
  it('accepts existing schema records and preserves empty playlists', async () => {
    const t = setup(), library = useApp.getState().libraries[0]
    const session: PlaylistSession = { ...t.session(), document: emptyDocument('Empty.m3u8'), entries: [], saved: [], undo: [], baseline: new Uint8Array() }
    await saveLibraries([{ ...library, sessions: { empty: session } }])
    expect((await loadLibraries())[0].sessions.empty.entries).toEqual([])
  })
})
