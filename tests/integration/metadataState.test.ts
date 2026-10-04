import { describe, expect, it, vi } from 'vitest'
import { applyMetadata, useApp, type Library } from '../../src/app/store'
import type { Track } from '../../src/domain/models'
describe('progressive metadata state', () => {
  it('batches updates and rejects stale generation results without losing artwork', async () => {
    vi.useFakeTimers()
    const track: Track = { id: 'track', path: 'Song.wav', filename: 'Song.wav', size: 10, lastModified: 0, index: null,
      metadataStatus: 'pending', metadata: { title: 'Fallback', album: '', artist: '' }, support: 'likely' }
    const library: Library = { id: 'library', name: 'Music', kind: 'portable', connected: true, scanning: false, generation: 2, tracks: { track }, playlists: [], files: [], sessions: {} }
    useApp.setState({ libraries: [library], activeLibrary: library.id })
    const subscriber = vi.fn(), unsubscribe = useApp.subscribe(subscriber)
    const artwork = new Blob(['thumbnail'], { type: 'image/png' })
    applyMetadata('library', 1, 'track', { title: 'Stale', artist: '', album: '' })
    applyMetadata('library', 2, 'track', { title: 'Tagged', artist: 'Artist', album: 'Album', artwork })
    applyMetadata('library', 2, 'track', { title: 'Tagged', artist: 'Artist', album: 'Album' })
    expect(subscriber).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(useApp.getState().libraries[0].tracks.track.metadata.title).toBe('Tagged')
    expect(useApp.getState().libraries[0].tracks.track.metadata.artwork).toBe(artwork)
    applyMetadata('library', 2, 'track', { title: 'Late', artist: '', album: '' })
    useApp.setState({ libraries: [{ ...useApp.getState().libraries[0], generation: 3 }] })
    await vi.advanceTimersByTimeAsync(50)
    expect(useApp.getState().libraries[0].tracks.track.metadata.title).toBe('Tagged')
    unsubscribe(); vi.useRealTimers()
  })
})
