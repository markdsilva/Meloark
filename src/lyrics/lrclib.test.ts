import { afterEach, describe, expect, it, vi } from 'vitest'
import { isReliableMatch, lookupLyrics, LyricsRequestError, resultDocument, searchLyrics, type LyricsResult } from './lrclib'
const metadata = { title: 'Song', artist: 'Artist', album: 'Album' }
const result: LyricsResult = { id: 10, trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: 180, instrumental: false, syncedLyrics: '[00:01]Words', plainLyrics: 'Words' }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('LRCLIB browser client', () => {
  it('sends only lookup metadata with cancellation, no credentials, and no referrer', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(result)))
    vi.stubGlobal('fetch', fetch)
    expect(await lookupLyrics(metadata, 180, new AbortController().signal)).toEqual(result)
    const [url, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.origin).toBe('https://lrclib.net')
    expect([...url.searchParams.keys()].sort()).toEqual(['album_name', 'artist_name', 'duration', 'track_name'])
    expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(options.body).toBeUndefined()
  })
  it('treats 404 as a miss and rejects doubtful versions without stripping recording qualifiers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    expect(await lookupLyrics(metadata, 180, new AbortController().signal)).toBeNull()
    expect(isReliableMatch(result, metadata, 181.9)).toBe(true)
    expect(isReliableMatch(result, metadata, 183)).toBe(false)
    expect(isReliableMatch({ ...result, trackName: 'Song (Live)' }, metadata, 180)).toBe(false)
    expect(isReliableMatch({ ...result, artistName: 'Other' }, metadata, 180)).toBe(false)
    expect(isReliableMatch({ ...result, albumName: 'Other' }, metadata, 180)).toBe(false)
    expect(isReliableMatch(result, metadata, 0)).toBe(false)
    expect(isReliableMatch(result, { ...metadata, title: ' song ', artist: 'ARTIST' }, 180)).toBe(true)
  })
  it('supports instrumental and plain results and rejects unusable lyrics', () => {
    expect(resultDocument({ ...result, instrumental: true }).kind).toBe('instrumental')
    expect(resultDocument({ ...result, syncedLyrics: null }).kind).toBe('plain')
    expect(resultDocument(result).kind).toBe('synced')
    expect(() => resultDocument({ ...result, syncedLyrics: null, plainLyrics: null })).toThrow('no usable lyrics')
  })
  it('validates search responses and bounds the result list', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(Array.from({ length: 25 }, (_, index) => ({ ...result, id: index })))))
    vi.stubGlobal('fetch', fetch)
    expect(await searchLyrics('Song', 'Artist', new AbortController().signal)).toHaveLength(20)
    await expect(searchLyrics('', 'Artist', new AbortController().signal)).rejects.toThrow('Enter a song title')
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ invalid: true })))
    await expect(searchLyrics('Song', 'Artist', new AbortController().signal)).rejects.toThrow('invalid search')
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ ...result, syncedLyrics: 'a'.repeat(600_000) })))
    await expect(lookupLyrics(metadata, 180, new AbortController().signal)).rejects.toThrow('oversized')
  })
  it('honors retry-after and keeps transient network failure separate from missing lyrics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } })))
    try { await lookupLyrics(metadata, 180, new AbortController().signal); throw new Error('Expected failure') }
    catch (error) { expect(error).toBeInstanceOf(LyricsRequestError); expect((error as LyricsRequestError).retryAt).toBeGreaterThanOrEqual(Date.now() + 59_000) }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Offline') }))
    await expect(lookupLyrics(metadata, 180, new AbortController().signal)).rejects.toThrow('unreachable')
  })
  it('times out stalled requests and propagates explicit cancellation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: URL, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')))
    })))
    const request = lookupLyrics(metadata, 180, new AbortController().signal)
    const rejection = expect(request).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(10_001); await rejection
    const controller = new AbortController(), canceled = lookupLyrics(metadata, 180, controller.signal)
    const canceledResult = expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await canceledResult
  })
})
