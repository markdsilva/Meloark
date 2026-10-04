import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deletePlaylistFile, inspectPlaylistDeletion, playlistPaths, playlistSession, removePlaylistFromApp, restorePlaylist, sources, useApp, type Library } from '../../src/app/store'
import { emptyDocument } from '../../src/playlists/codec'
import type { LibrarySource } from '../../src/platform/filesystem/types'
import { player } from '../../src/playback/player'
import { UnverifiedDeleteError } from '../../src/platform/filesystem/deleteProtocol'
import { File as NodeFile } from 'node:buffer'
const bytes = new TextEncoder().encode('#EXTM3U\n')
function setup() {
  const document = emptyDocument('List.m3u8')
  const library: Library = { id: 'delete-test', name: 'Music', kind: 'direct', connected: true, scanning: false, generation: 1, tracks: {}, playlists: ['List.m3u8'], files: ['List.m3u8'], activePlaylist: 'List.m3u8', sessions: {
    'List.m3u8': { id: 'List.m3u8', name: 'List', document, entries: [], saved: [], baseline: bytes, undo: [], redo: [], revision: 0, status: 'saved' },
  } }
  useApp.setState({ libraries: [library], activeLibrary: library.id, view: 'playlist', busy: false, storageError: undefined })
  const source = { kind: 'direct', name: 'Music', readFile: vi.fn(async () => new NodeFile([bytes], 'List.m3u8') as unknown as File), requestAccess: vi.fn(async () => true), deletePlaylist: vi.fn(async (path: string) => ({ path, deleted: true })) } as unknown as LibrarySource
  sources.set(library.id, source)
  return { source, library: () => useApp.getState().libraries[0] }
}
beforeEach(() => { vi.useFakeTimers(); player.configure(undefined, [], {}, undefined) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); sources.clear() })
describe('playlist lifecycle', () => {
  it('app removal hides on-disk playlists, keeps inventory and allows restoration', () => {
    const t = setup(); removePlaylistFromApp('List.m3u8')
    expect(playlistPaths(t.library())).toEqual([])
    expect(t.library().playlists).toEqual(['List.m3u8'])
    expect(t.library().sessions).toEqual({})
    expect(t.source.deletePlaylist).not.toHaveBeenCalled()
    expect(useApp.getState().view).toBe('library')
    restorePlaylist('List.m3u8'); expect(playlistPaths(t.library())).toEqual(['List.m3u8'])
  })
  it('a legacy source and its output draft are separate removal targets', () => {
    const t = setup(), library = t.library(), session = library.sessions['List.m3u8']
    useApp.setState({ libraries: [{ ...library, playlists: ['Legacy.m3u'], sessions: { 'Legacy.m3u': { ...session, id: 'Legacy.m3u', sourcePath: 'Legacy.m3u', baseline: null } } }] })
    expect(playlistPaths(t.library())).toEqual(['Legacy.m3u', 'List.m3u8'])
    expect(playlistSession(t.library(), 'Legacy.m3u')).toBeUndefined()
    removePlaylistFromApp('Legacy.m3u')
    expect(playlistPaths(t.library())).toEqual(['List.m3u8'])
    removePlaylistFromApp('List.m3u8'); expect(t.library().sessions).toEqual({})
  })
  it('captures expected bytes without requesting write permission', async () => {
    const t = setup(); expect([...await inspectPlaylistDeletion('List.m3u8')]).toEqual([...bytes])
    expect(t.source.requestAccess).not.toHaveBeenCalled()
  })
  it('rejects changed baselines before presenting a deletable version', async () => {
    const t = setup(); t.source.readFile = async () => new NodeFile(['external'], 'List.m3u8') as unknown as File
    await expect(inspectPlaylistDeletion('List.m3u8')).rejects.toThrow('changed outside')
    expect(t.source.deletePlaylist).not.toHaveBeenCalled()
  })
  it('denied permission leaves the session and inventory untouched', async () => {
    const t = setup(); t.source.requestAccess = async () => false
    await expect(deletePlaylistFile('List.m3u8', bytes)).rejects.toThrow('permission')
    expect(t.source.deletePlaylist).not.toHaveBeenCalled(); expect(t.library().activePlaylist).toBe('List.m3u8')
    expect(useApp.getState().busy).toBe(false)
  })
  it('verification failure retains state', async () => {
    const t = setup(); t.source.deletePlaylist = async () => { throw new UnverifiedDeleteError('Check the file') }
    await expect(deletePlaylistFile('List.m3u8', bytes)).rejects.toBeInstanceOf(UnverifiedDeleteError)
    expect(t.library().sessions['List.m3u8']).toBeDefined(); expect(t.library().playlists).toEqual(['List.m3u8'])
  })
  it('verified deletion remains committed when cache persistence fails', async () => {
    const t = setup(); vi.stubGlobal('indexedDB', { open() { throw new Error('Quota exceeded') } })
    expect(await deletePlaylistFile('List.m3u8', bytes)).toBe(true)
    expect(t.library().playlists).toEqual([]); expect(t.library().sessions).toEqual({})
    expect(useApp.getState().storageError).toContain('unavailable or full')
  })
})
