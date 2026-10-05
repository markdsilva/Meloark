import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { useApp, sources, forgetLibrary, type Library } from '../../src/app/store'
import { usePlayer } from '../../src/playback/player'
import { chooseLocalLyrics, chooseLyricsResult, closeLyrics, correctLyrics, findLyrics, importLyrics, loadCurrentLyrics, setLyricsOnline, useLyrics } from '../../src/lyrics/store'
import { loadLibraries, loadLyrics, saveLibraries, saveLyrics } from '../../src/platform/persistence/database'
import { parseLrc, trackFingerprint } from '../../src/lyrics/lrc'
import type { Track } from '../../src/domain/models'
import type { LibrarySource } from '../../src/platform/filesystem/types'
import type { LyricsResult } from '../../src/lyrics/lrclib'
const onlineResult: LyricsResult = { id: 123, trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: 180, instrumental: false, syncedLyrics: '[00:01]Online\n[00:04]Next', plainLyrics: 'Online\nNext' }
function file(name: string, text: string) { const bytes = new TextEncoder().encode(text); return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer } as File }
function setup(files: Record<string, File> = {}) {
  const id = crypto.randomUUID()
  const track: Track = { id: `${id}:Song.mp3`, path: 'Song.mp3', filename: 'Song.mp3', size: 100, lastModified: 1, index: null, metadataStatus: 'ready', support: 'likely', metadata: { title: 'Song', titleFromTag: true, artist: 'Artist', album: 'Album', duration: 180 } }
  const library: Library = { id, name: 'Music', kind: 'portable', connected: true, scanning: false, generation: 1, tracks: { [track.id]: track }, playlists: [], files: [track.path, ...Object.keys(files)], sessions: {} }
  useApp.setState({ libraries: [library], activeLibrary: id, busy: false })
  usePlayer.setState({ track, current: track.id, context: { kind: 'library', libraryId: id }, duration: 180 })
  const readFile = vi.fn(async (path: string) => { if (!files[path]) throw new Error('Missing local file'); return files[path] })
  sources.set(id, { kind: 'portable', name: 'Music', readFile } as unknown as LibrarySource)
  return { track, library, readFile }
}
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  sources.clear()
  useLyrics.setState({ open: true, online: 'ask', status: 'idle', record: undefined, error: undefined, cacheError: undefined, notice: undefined, retryAt: undefined, localPaths: [], results: [], searching: false })
})
afterEach(() => { closeLyrics(); vi.unstubAllGlobals() })
describe('lyrics lifecycle', () => {
  it('uses a sidecar before online lookup and does not change playlist state', async () => {
    const t = setup({ 'Song.lrc': file('Song.lrc', '[00:01]Local words') }), before = useApp.getState().libraries[0].sessions
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); setLyricsOnline('enabled')
    await loadCurrentLyrics()
    expect(useLyrics.getState().record?.document.cues[0].text).toBe('Local words')
    expect(fetch).not.toHaveBeenCalled()
    expect(useApp.getState().libraries[0].sessions).toBe(before)
    await waitFor(async () => expect((await loadLyrics(t.track.id))?.document.source.path).toBe('Song.lrc'))
  })
  it('never fetches without opt-in, when closed, or while hidden', async () => {
    setup(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await loadCurrentLyrics(); expect(useLyrics.getState().status).toBe('local-only')
    setLyricsOnline('enabled'); closeLyrics(); await loadCurrentLyrics()
    useLyrics.setState({ open: true }); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); await loadCurrentLyrics()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not send a filename-derived title to automatic lookup', async () => {
    const t = setup(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    usePlayer.setState({ track: { ...t.track, metadata: { ...t.track.metadata, titleFromTag: false } } })
    setLyricsOnline('enabled'); await loadCurrentLyrics()
    expect(useLyrics.getState().status).toBe('needs-metadata')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('caches a reliable online response and shares it across duplicate playlist occurrences', async () => {
    const t = setup(), fetch = vi.fn(async () => new Response(JSON.stringify(onlineResult)))
    vi.stubGlobal('fetch', fetch); setLyricsOnline('enabled'); await loadCurrentLyrics()
    expect(useLyrics.getState().record?.document.source.providerId).toBe(123)
    await waitFor(async () => expect((await loadLyrics(t.track.id))?.fingerprint).toBe(trackFingerprint(t.track)))
    usePlayer.setState({ current: 'another occurrence', context: { kind: 'playlist', libraryId: t.library.id, sessionId: 'Mix' } })
    await loadCurrentLyrics(); expect(fetch).toHaveBeenCalledTimes(1)
    correctLyrics(200)
    await waitFor(async () => expect((await loadLyrics(t.track.id))?.correctionMs).toBe(200))
  })
  it('requires choosing ambiguous sidecars before resolving them', async () => {
    setup({ 'Song.lrc': file('Song.lrc', '[00:01]Stem'), 'Song.mp3.lrc': file('Song.mp3.lrc', '[00:01]Specific') })
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); setLyricsOnline('enabled')
    await loadCurrentLyrics(); expect(useLyrics.getState().status).toBe('local-choice')
    await chooseLocalLyrics('Song.mp3.lrc')
    expect(useLyrics.getState().record?.document.cues[0].text).toBe('Specific')
    expect(useLyrics.getState().record?.selected).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('imports lyrics, retains the selection, and resets correction for a different version', async () => {
    const t = setup(); await importLyrics(file('Custom.lrc', '[00:02]My words'))
    correctLyrics(300)
    await loadCurrentLyrics(); expect(useLyrics.getState().record?.correctionMs).toBe(300)
    await importLyrics(file('Other.lrc', '[00:05]Other words'))
    expect(useLyrics.getState().record?.correctionMs).toBe(0)
    await waitFor(async () => expect((await loadLyrics(t.track.id))?.document.source.label).toBe('Other.lrc'))
    await importLyrics(file('Invalid.txt', 'Wrong'))
    expect(useLyrics.getState().record?.document.source.label).toBe('Other.lrc')
    expect(useLyrics.getState().error).toContain('Choose an .lrc')
  })
  it('rejects cached data after an audio fingerprint changes', async () => {
    const t = setup()
    await saveLyrics({ trackId: t.track.id, libraryId: t.library.id, fingerprint: 'stale', selected: true, correctionMs: 0, savedAt: 1, document: parseLrc('[00:01]Old', { kind: 'import', label: 'Old.lrc' }) })
    await loadCurrentLyrics()
    expect(useLyrics.getState().record).toBeUndefined()
    expect(useLyrics.getState().status).toBe('local-only')
  })
  it('ignores late network results after track changes or closing the panel', async () => {
    const t = setup(); let finish!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetch); setLyricsOnline('enabled')
    const pending = loadCurrentLyrics(); await waitFor(() => expect(fetch).toHaveBeenCalled())
    usePlayer.setState({ track: { ...t.track, id: 'different' }, current: 'different' }); closeLyrics()
    finish(new Response(JSON.stringify(onlineResult))); await pending
    expect(useLyrics.getState().record).toBeUndefined()
    expect(await loadLyrics(t.track.id)).toBeUndefined()
  })
  it('requires review for a wrong recording and protects version selection from stale tracks', async () => {
    const t = setup(); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...onlineResult, duration: 240 }))))
    setLyricsOnline('enabled'); await loadCurrentLyrics()
    expect(useLyrics.getState().status).toBe('not-found'); expect(useLyrics.getState().record).toBeUndefined()
    chooseLyricsResult(onlineResult, 'stale track'); expect(useLyrics.getState().record).toBeUndefined()
    chooseLyricsResult(onlineResult, t.track.id); expect(useLyrics.getState().record?.selected).toBe(true)
    await waitFor(async () => expect((await loadLyrics(t.track.id))?.selected).toBe(true))
  })
  it('does not repeatedly query a miss and honors cooldown across new searches', async () => {
    setup(); const fetch = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetch); setLyricsOnline('enabled')
    await loadCurrentLyrics(); await loadCurrentLyrics(); expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }))
    await loadCurrentLyrics(true); expect(useLyrics.getState().retryAt).toBeGreaterThan(Date.now())
    await loadCurrentLyrics(true); await findLyrics('Different title', 'Artist'); expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('keeps lyrics usable after browser storage failure without affecting the library', async () => {
    setup(); vi.stubGlobal('indexedDB', { open() { throw new Error('Storage blocked') } })
    await importLyrics(file('Offline.lrc', '[00:00]Usable words'))
    await waitFor(() => expect(useLyrics.getState().cacheError).toContain('could not be remembered'))
    expect(useLyrics.getState().record?.document.cues[0].text).toBe('Usable words')
    expect(useApp.getState().libraries[0].sessions).toEqual({})
  })
})
describe('lyrics database upgrade', () => {
  it('upgrades version 1 without losing library records or drafts', async () => {
    const t = setup()
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('trackindex-web', 1)
      open.onupgradeneeded = () => { open.result.createObjectStore('libraries', { keyPath: 'id' }); open.result.createObjectStore('handles') }
      open.onerror = () => reject(open.error)
      open.onsuccess = () => { const db = open.result, tx = db.transaction('libraries', 'readwrite'); tx.objectStore('libraries').put(t.library); tx.oncomplete = () => { db.close(); resolve() } }
    })
    expect((await loadLibraries())[0].id).toBe(t.library.id)
    await importLyrics(file('Song.lrc', '[00:00]After upgrade'))
    await waitFor(async () => expect((await loadLyrics(t.track.id))?.document.cues[0].text).toBe('After upgrade'))
    expect((await loadLibraries())[0].tracks[t.track.id].path).toBe('Song.mp3')
  })
  it('keeps lyrics independent of library snapshot writes', async () => {
    const t = setup(); await importLyrics(file('Song.lrc', '[00:00]Independent'))
    await waitFor(async () => expect(await loadLyrics(t.track.id)).toBeTruthy())
    await saveLibraries([t.library]); expect((await loadLyrics(t.track.id))?.document.cues[0].text).toBe('Independent')
  })
  it('forgets lyrics and drains pending cache writes when removing a library', async () => {
    const t = setup(); await importLyrics(file('Song.lrc', '[00:00]Private copy'))
    correctLyrics(100); correctLyrics(200)
    await forgetLibrary(t.library.id)
    expect(await loadLyrics(t.track.id)).toBeUndefined()
    expect(useLyrics.getState().record).toBeUndefined()
    expect(useApp.getState().libraries).toEqual([])
  })
})
