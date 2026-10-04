import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { sources, useApp } from '../app/store'
import { scheduleMetadata } from './scheduler'
import type { LibrarySource } from '../platform/filesystem/types'
import type { TrackMetadata } from '../domain/models'
const parse = vi.hoisted(() => vi.fn())
vi.mock('./parser', () => ({ readMetadata: parse }))
beforeEach(() => { sources.clear(); parse.mockReset() })
function oldCache() {
  const artwork = new Blob(['thumbnail'], { type: 'image/webp' })
  useApp.setState({ activeLibrary: 'cache', libraries: [{ id: 'cache', name: 'Remembered', kind: 'portable', connected: true, scanning: false, generation: 1,
    tracks: { song: { id: 'song', path: 'Song.wav', filename: 'Song.wav', size: 100, lastModified: 1, index: null, support: 'likely', metadataStatus: 'ready', metadata: { title: 'Old tags', artist: 'Artist', album: 'Album', artwork } } }, files: ['Song.wav'], playlists: [], sessions: {} }] })
  sources.set('cache', { readFile: vi.fn(async () => new File(['local'], 'Song.wav')) } as unknown as LibrarySource)
  return artwork
}
describe('technical metadata cache backfill', () => {
  it('progressively upgrades ready older tracks without dropping their artwork or session state', async () => {
    const artwork = oldCache(), sessions = useApp.getState().libraries[0].sessions
    parse.mockResolvedValue({ title: 'Old tags', artist: 'Artist', album: 'Album', sampleRate: 44100, technicalVersion: 1 })
    scheduleMetadata('cache')
    await waitFor(() => expect(useApp.getState().libraries[0].tracks.song.metadata.technicalVersion).toBe(1))
    expect(useApp.getState().libraries[0].tracks.song.metadata.artwork).toBe(artwork)
    expect(useApp.getState().libraries[0].sessions).toBe(sessions)
    expect(parse).toHaveBeenCalledTimes(1)
    scheduleMetadata('cache'); await new Promise(resolve => setTimeout(resolve, 10)); expect(parse).toHaveBeenCalledTimes(1)
  })
  it('does not apply a delayed backfill to a newer library generation', async () => {
    oldCache(); let finish!: (metadata: TrackMetadata) => void
    parse.mockImplementation(() => new Promise<TrackMetadata>(resolve => { finish = resolve }))
    scheduleMetadata('cache'); await waitFor(() => expect(parse).toHaveBeenCalled())
    useApp.setState(state => ({ libraries: state.libraries.map(library => ({ ...library, generation: 2 })) }))
    finish({ title: 'Stale', artist: '', album: '', technicalVersion: 1 })
    await new Promise(resolve => setTimeout(resolve, 75))
    expect(useApp.getState().libraries[0].tracks.song.metadata.title).toBe('Old tags')
  })
})
