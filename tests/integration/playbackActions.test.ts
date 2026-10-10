import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addTracks, createPlaylist, playLibraryTrack, playPlaylistEntry, playSearchTrack, removeEntries, scanLibrary, selectLibrary, sources, updateLibrary, useApp, type Library } from '../../src/app/store'
import { player, usePlayer } from '../../src/playback/player'
import type { LibrarySource } from '../../src/platform/filesystem/types'
import type { Track } from '../../src/domain/models'
const tracks = Object.fromEntries(['a', 'b', 'c'].map(id => [id, { id, path: `${id}.wav`, filename: `${id}.wav`, size: 10, lastModified: 0, index: null, metadataStatus: 'ready', metadata: { title: id, artist: '', album: '' }, support: 'likely' } satisfies Track]))
export function fixtureLibrary(): Library { return { id: 'test', name: 'Music', kind: 'portable', connected: true, scanning: false, generation: 1, tracks, playlists: [], files: [], sessions: {} } }
beforeEach(() => {
  vi.useFakeTimers(); player.configure(undefined, [], {}, undefined)
  useApp.setState({ libraries: [fixtureLibrary()], activeLibrary: 'test', busy: false, view: 'library', visibleTrackIds: ['b', 'a', 'c'] })
  sources.set('test', { kind: 'portable', name: 'Music' } as LibrarySource)
  vi.spyOn(player, 'play').mockResolvedValue(undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); sources.clear() })
describe('independent library playback', () => {
  it('plays search results from another library without changing the active draft or view', () => {
    createPlaylist('Draft'); addTracks(['a', 'b'])
    const current = useApp.getState(), draft = current.libraries[0].sessions['Draft.m3u8']
    const other = { ...fixtureLibrary(), id: 'other', name: 'Other music' }
    useApp.setState({ libraries: [...current.libraries, other] }); sources.set('other', sources.get('test')!)
    expect(playSearchTrack('other', 'c', ['a', 'b', 'c'])).toBe(true)
    expect(useApp.getState()).toMatchObject({ activeLibrary: 'test', view: current.view, visibleTrackIds: current.visibleTrackIds })
    expect(useApp.getState().libraries[0].sessions['Draft.m3u8']).toBe(draft)
    expect(usePlayer.getState().context).toEqual({ kind: 'search', libraryId: 'other' })
    updateLibrary('test', library => ({ ...library, scanError: 'Unrelated change' }))
    expect(player.queue.current).toBe('c')
    expect(player.play).toHaveBeenCalledTimes(1)
    updateLibrary('other', library => ({ ...library, tracks: { ...library.tracks, c: { ...library.tracks.c, path: 'renamed.wav' } } }))
    expect(player.queue.current).toBe('c')
    expect(usePlayer.getState().track?.path).toBe('renamed.wav')
  })
  it('keeps search queue ordering after the selected song and reconciles missing tracks', () => {
    playSearchTrack('test', 'b', ['a', 'b', 'c', 'c'])
    expect(player.queue.entries.map(entry => entry.id)).toEqual(['a', 'b', 'c'])
    updateLibrary('test', library => ({ ...library, tracks: { a: library.tracks.a, c: library.tracks.c } }))
    expect(player.queue.current).toBe('c')
    expect(player.queue.entries.map(entry => entry.id)).toEqual(['a', 'c'])
  })
  it.each(['disconnected', 'unsupported', 'recovery'])('refuses %s search playback without replacing the existing queue', condition => {
    playLibraryTrack('a')
    updateLibrary('test', library => ({ ...library, connected: condition !== 'disconnected', syncRecovery: condition === 'recovery' ? 'Recover first' : undefined, tracks: condition === 'unsupported' ? { ...library.tracks, b: { ...library.tracks.b, support: 'unsupported' } } : library.tracks }))
    expect(playSearchTrack('test', 'b')).toBe(false)
    expect(player.queue.current).toBe('a')
  })
  it('plays without a playlist and captures visible ordering without membership changes', () => {
    playLibraryTrack('a')
    expect(player.queue.entries.map(item => item.id)).toEqual(['b', 'a', 'c'])
    expect(player.play).toHaveBeenCalledWith('a')
    useApp.setState({ visibleTrackIds: ['c'] })
    expect(player.queue.entries.map(item => item.id)).toEqual(['b', 'a', 'c'])
    expect(useApp.getState().libraries[0].sessions).toEqual({})
  })
  it('creating and adding to a playlist preserves the browse queue', () => {
    playLibraryTrack('a'); createPlaylist('Empty')
    expect(usePlayer.getState().context?.kind).toBe('library')
    expect(player.queue.current).toBe('a')
    addTracks(['b'])
    expect(player.queue.current).toBe('a')
    expect(player.play).toHaveBeenCalledTimes(1)
  })
  it('Add & Play switches to the successfully committed occurrence', () => {
    createPlaylist('Empty'); addTracks(['a'], true)
    const session = useApp.getState().libraries[0].sessions['Empty.m3u8']
    expect(usePlayer.getState().context?.kind).toBe('playlist')
    expect(player.play).toHaveBeenCalledWith(session.entries[0].id)
  })
  it.each(['busy', 'unverified'])('does not play a blocked %s add', condition => {
    createPlaylist('Empty')
    if (condition === 'busy') useApp.setState({ busy: true })
    else { const library = useApp.getState().libraries[0]; library.sessions['Empty.m3u8'].status = 'unverified' }
    expect(addTracks(['a'], true)).toBe(false)
    expect(player.play).not.toHaveBeenCalled()
    expect(useApp.getState().libraries[0].sessions['Empty.m3u8'].entries).toHaveLength(0)
  })
  it('playlist playback reconciles removals and switches stop browsing', () => {
    createPlaylist('Tracks'); addTracks(['a', 'b', 'c'])
    const entries = useApp.getState().libraries[0].sessions['Tracks.m3u8'].entries
    playPlaylistEntry(entries[0].id); removeEntries(new Set([entries[0].id]))
    expect(player.queue.current).toBe(entries[1].id)
    playLibraryTrack('b'); selectLibrary('different')
    expect(player.queue.current).toBeNull()
  })
  it('refresh retains the browse queue while intermediate scan batches are incomplete', async () => {
    const library = fixtureLibrary()
    library.tracks = Object.fromEntries(Object.values(library.tracks).map(track => {
      const id = `${library.id}:${track.path}`
      return [id, { ...track, id, metadata: { ...track.metadata, technicalVersion: 1 } }]
    }))
    const ids = ['b', 'a', 'c'].map(name => `${library.id}:${name}.wav`)
    useApp.setState({ libraries: [library], visibleTrackIds: ids })
    sources.get(library.id)!.scan = async function* () {
      for (let index = 0; index < 100; index++) yield { reference: `notes${index}.txt`, path: `notes${index}.txt`, size: 10, lastModified: 0 }
      expect(player.queue.current).toBe(ids[0])
      for (const track of Object.values(library.tracks)) yield { reference: track.path, path: track.path, size: track.size, lastModified: track.lastModified }
    }
    playLibraryTrack(ids[0]); await scanLibrary(library.id)
    expect(player.queue.current).toBe(ids[0])
    expect(player.queue.entries.map(item => item.id)).toEqual(ids)
    expect(player.play).toHaveBeenCalledTimes(1)
  })
})
