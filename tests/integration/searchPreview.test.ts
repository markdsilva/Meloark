import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { File } from 'node:buffer'
import { sources, useApp } from '../../src/app/store'
import { previewSearchPlaylist } from '../../src/search/playlistPreview'
import type { LibrarySource } from '../../src/platform/filesystem/types'
import type { Track } from '../../src/domain/models'
import { parsePlaylist } from '../../src/playlists/codec'
const inspect = async (bytes: Uint8Array, path: string, tracks: [string, string][]) => {
  const document = parsePlaylist(bytes, path, new Map(tracks))
  if (document.issues.length) throw new Error(document.issues[0])
  return { trackIds: document.entries.flatMap(entry => entry.trackId && !entry.issue ? [entry.trackId] : []), missing: document.entries.filter(entry => !entry.trackId || !!entry.issue).length }
}

const track: Track = { id: 'song', path: 'Disc/Song.wav', filename: 'Song.wav', size: 1, lastModified: 0, index: null, metadataStatus: 'ready', metadata: { title: 'Song', artist: '', album: '' }, support: 'likely' }
beforeEach(() => {
  useApp.setState({ libraries: [{ id: 'library', name: 'Music', kind: 'portable', connected: true, scanning: false, generation: 1, tracks: { song: track }, playlists: ['Lists/Unrelated name.m3u8'], files: [], sessions: {} }], activeLibrary: 'somewhere else', view: 'albums' })
})
afterEach(() => sources.clear())
describe('search playlist preview', () => {
  it('reads relative playlist references without selecting, creating or saving a session', async () => {
    const file = new File(['#EXTM3U\n../Disc/Song.wav\n../Disc/Song.wav\nMissing.wav\n'], 'Unrelated name.m3u8')
    const readFile = vi.fn(async () => file)
    sources.set('library', { readFile } as unknown as LibrarySource)
    const before = useApp.getState()
    expect(await previewSearchPlaylist('library', 'Lists/Unrelated name.m3u8', inspect)).toEqual({ trackIds: ['song', 'song'], missing: 1 })
    expect(useApp.getState()).toBe(before)
    expect(readFile).toHaveBeenCalledTimes(1)
  })
  it('uses the current draft rather than stale disk order', async () => {
    const library = useApp.getState().libraries[0]
    const session = { id: 'draft', name: 'Draft', entries: [{ id: '1', raw: track.path, prelude: [], trackId: track.id }], saved: [], baseline: null, undo: [], redo: [], revision: 2, status: 'new' as const }
    useApp.setState({ libraries: [{ ...library, sessions: { draft: session }, connected: false }] })
    expect(await previewSearchPlaylist('library', 'draft')).toEqual({ trackIds: ['song'], missing: 0 })
  })
  it('refuses inaccessible or hidden playlists and HLS manifests', async () => {
    const library = useApp.getState().libraries[0]
    useApp.setState({ libraries: [{ ...library, connected: false }] })
    await expect(previewSearchPlaylist('library', 'Lists/Unrelated name.m3u8')).rejects.toThrow('Reconnect')
    useApp.setState({ libraries: [{ ...library, hiddenPlaylists: ['Lists/Unrelated name.m3u8'] }] })
    await expect(previewSearchPlaylist('library', 'Lists/Unrelated name.m3u8')).rejects.toThrow('no longer')
    useApp.setState({ libraries: [library] })
    sources.set('library', { readFile: async () => new File(['#EXTM3U\n#EXT-X-TARGETDURATION:10\n'], 'playlist') } as unknown as LibrarySource)
    await expect(previewSearchPlaylist('library', 'Lists/Unrelated name.m3u8', inspect)).rejects.toThrow('HLS')
  })
})
