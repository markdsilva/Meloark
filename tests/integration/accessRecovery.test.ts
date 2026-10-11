import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { File as NodeFile } from 'node:buffer'
import { addSource, bootstrap, createPlaylist, addTracks, reconnect, restoreWriteAccess, retryBrowserStorage, sources, useApp, type Library } from '../../src/app/store'
import { DirectSource } from '../../src/platform/filesystem/direct'
import type { DirectoryHandle } from '../../src/platform/filesystem/types'
import { player, usePlayer } from '../../src/playback/player'

function fixture() {
  const permission = { read: 'granted', write: 'granted', grant: true, missing: false, closeDenied: false }
  const audio = new NodeFile(['audio'], 'Song.wav', { lastModified: 0 })
  const write = vi.fn(), request = vi.fn(async ({ mode }: { mode: string }) => {
    if (permission.grant) { permission.read = 'granted'; if (mode === 'readwrite') permission.write = 'granted' }
    return permission.grant ? 'granted' : 'denied'
  })
  const root = { name: 'Music', queryPermission: vi.fn(async ({ mode }: { mode: string }) => mode === 'read' ? permission.read : permission.write), requestPermission: request,
    entries: async function* () { yield ['Song.wav', await root.getFileHandle('Song.wav')] },
    getFileHandle: async (name: string) => {
      if (permission.read !== 'granted') throw new DOMException('Read denied', 'NotAllowedError')
      if (name === '.meloark-order-sync.json' || permission.missing) throw new DOMException('Missing', 'NotFoundError')
      return { kind: 'file', getFile: async () => {
        if (permission.read !== 'granted') throw new DOMException('Read denied', 'NotAllowedError')
        return audio
      }, createWritable: async () => ({ write, close: async () => { if (permission.closeDenied) throw new DOMException('Write denied', 'NotAllowedError') }, abort: async () => {} }) }
    },
  }
  const source = new DirectSource(root as unknown as DirectoryHandle)
  const track = { id: 'song', path: 'Song.wav', filename: 'Song.wav', size: audio.size, lastModified: 0, index: null, metadataStatus: 'ready' as const,
    metadata: { title: 'Song', album: '', artist: '', technicalVersion: 1 }, support: 'likely' as const }
  const library: Library = { id: 'music', name: 'Music', kind: 'direct', connected: true, scanning: false, generation: 1, tracks: { song: track }, files: ['Song.wav'], playlists: [], sessions: {} }
  useApp.setState({ libraries: [library], activeLibrary: library.id, view: 'library', ready: true, busy: false, accessIssues: {}, storageError: undefined })
  sources.set(library.id, source)
  createPlaylist('Draft'); addTracks(['song'])
  return { source, permission, request, write, library: () => useApp.getState().libraries[0] }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); vi.stubGlobal('crypto', webcrypto)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  player.configure(undefined, [], {}); sources.clear()
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); sources.clear(); useApp.setState({ accessIssues: {} }) })

describe('recoverable folder access', () => {
  it('deduplicates permission loss, keeps the draft, and reconnects only after a request', async () => {
    const f = fixture(), draft = f.library().sessions['Draft.m3u8']
    f.permission.read = 'prompt'
    await f.source.getAccess()
    const issue = useApp.getState().accessIssues.music
    await expect(f.source.readFile('Song.wav')).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(useApp.getState().accessIssues.music).toBe(issue)
    expect(f.library().connected).toBe(false)
    expect(f.library().sessions['Draft.m3u8']).toBe(draft)
    expect(f.request).not.toHaveBeenCalled()
    f.permission.grant = false
    expect(await reconnect('music')).toBe(false)
    expect(f.library().connected).toBe(false)
    expect(f.library().syncRecovery).toBeUndefined()
    f.permission.grant = true
    expect(await reconnect('music')).toBe(true)
    expect(f.library().sessions['Draft.m3u8'].entries).toEqual(draft.entries)
    expect(useApp.getState().accessIssues.music).toBeUndefined()
    expect(f.request).toHaveBeenCalledTimes(2)
  })
  it('does not treat a missing track as expired permission', async () => {
    const f = fixture(); f.permission.missing = true
    await expect(f.source.readFile('Song.wav')).rejects.toMatchObject({ name: 'NotFoundError' })
    expect(f.library().connected).toBe(true)
    expect(useApp.getState().accessIssues).toEqual({})
  })
  it('keeps read access and drafts on write denial, and granting write permission does not retry a write', async () => {
    const f = fixture(), draft = f.library().sessions['Draft.m3u8']; f.permission.write = 'prompt'
    await expect(f.source.writePlaylist('Draft.m3u8', new Uint8Array(), null)).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(useApp.getState().accessIssues.music.intent).toBe('write')
    expect(f.library().connected).toBe(true)
    expect(await f.source.readFile('Song.wav')).toBeTruthy()
    expect(f.write).not.toHaveBeenCalled()
    expect(await restoreWriteAccess('music')).toBe(true)
    expect(useApp.getState().accessIssues.music).toBeUndefined()
    expect(f.write).not.toHaveBeenCalled()
    expect(f.library().sessions['Draft.m3u8']).toBe(draft)
    expect(f.request).toHaveBeenCalledWith({ mode: 'readwrite' })
  })
  it('reports permission loss inside a write even when verification wraps the exception', async () => {
    const f = fixture(); f.permission.closeDenied = true
    // Existing target matches the reviewed baseline; failure happens at close.
    await expect(f.source.writePlaylist('Draft.m3u8', new Uint8Array([1]), new Uint8Array(await (await f.source.readFile('Song.wav')).arrayBuffer()))).rejects.toThrow()
    expect(useApp.getState().accessIssues.music.intent).toBe('write')
    expect(f.library().connected).toBe(true)
  })
  it('stops a denied file read without declaring every queued song unavailable', async () => {
    const f = fixture()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'removeAttribute').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    player.configure({ kind: 'library', libraryId: 'music' }, [{ id: 'song', trackId: 'song' }, { id: 'other', trackId: 'song' }], f.library().tracks, f.source)
    f.permission.read = 'denied'
    await player.play('song')
    expect(f.library().connected).toBe(false)
    expect(player.queue.unavailable.size).toBe(0)
    expect(usePlayer.getState().error).toContain('Folder access')
  })
  it('keeps autoplay denial separate from folder access', async () => {
    const f = fixture()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('Autoplay needs a gesture', 'NotAllowedError'))
    player.configure({ kind: 'library', libraryId: 'music' }, [{ id: 'song', trackId: 'song' }], f.library().tracks, f.source)
    await player.play('song')
    expect(f.library().connected).toBe(true)
    expect(useApp.getState().accessIssues).toEqual({})
    expect(usePlayer.getState().error).toContain('user action')
    expect(player.queue.unavailable.size).toBe(0)
  })
  it('retries browser storage separately and keeps the warning if folder handles cannot be remembered', async () => {
    const f = fixture()
    useApp.setState({ storageError: 'The folder opened, but its handle could not be remembered. Reselect it next time.' })
    expect(await retryBrowserStorage()).toBe(false) // Mock handles contain functions and cannot be cloned.
    expect(useApp.getState().storageError).toBeTruthy()
    sources.delete(f.library().id)
    expect(await retryBrowserStorage()).toBe(true)
    expect(useApp.getState().storageError).toBeUndefined()
    expect(f.request).not.toHaveBeenCalled()
  })
  it('reselecting another library keeps the active playlist and draft in place', async () => {
    await bootstrap()
    const f = fixture(), draft = f.library().sessions['Draft.m3u8']
    useApp.setState({ libraries: [f.library(), { ...f.library(), id: 'other', connected: false }], activeLibrary: 'music', view: 'playlist' })
    await addSource(f.source, 'other', false)
    expect(useApp.getState()).toMatchObject({ activeLibrary: 'music', view: 'playlist' })
    expect(f.library().sessions['Draft.m3u8']).toBe(draft)
    expect(useApp.getState().libraries[1].connected).toBe(true)
  })
})
