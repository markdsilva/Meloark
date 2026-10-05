import type { TrackMetadata } from '../domain/models'
import { MAX_LYRICS_BYTES, parseLrc } from './lrc'
import type { LyricsDocument } from './types'

const API = 'https://lrclib.net/api'
export interface LyricsResult {
  id: number; trackName: string; artistName: string; albumName: string; duration: number
  instrumental: boolean; syncedLyrics: string | null; plainLyrics: string | null
}
export class LyricsRequestError extends Error {
  constructor(message: string, readonly retryAt?: number) { super(message) }
}
function record(value: unknown): LyricsResult {
  if (!value || typeof value !== 'object') throw new Error('LRCLIB returned an invalid response.')
  const item = value as Record<string, unknown>
  if (!Number.isSafeInteger(item.id) || typeof item.trackName !== 'string' || typeof item.artistName !== 'string') throw new Error('LRCLIB returned an invalid track.')
  for (const key of ['syncedLyrics', 'plainLyrics']) if (item[key] != null && (typeof item[key] !== 'string' || new TextEncoder().encode(item[key] as string).length > MAX_LYRICS_BYTES)) throw new Error('LRCLIB returned oversized or invalid lyrics.')
  return { id: item.id as number, trackName: item.trackName, artistName: item.artistName,
    albumName: typeof item.albumName === 'string' ? item.albumName : '', duration: typeof item.duration === 'number' ? item.duration : NaN,
    instrumental: item.instrumental === true, syncedLyrics: typeof item.syncedLyrics === 'string' ? item.syncedLyrics : null, plainLyrics: typeof item.plainLyrics === 'string' ? item.plainLyrics : null }
}
async function request(path: string, params: Record<string, string>, signal: AbortSignal): Promise<unknown | null> {
  const controller = new AbortController(), abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 10_000)
  try {
    const url = new URL(`${API}/${path}`)
    Object.entries(params).forEach(([key, value]) => { if (value) url.searchParams.set(key, value) })
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Lrclib-Client': 'TrackIndexWeb/1.0' } })
    if (response.status === 404) return null
    if (response.status === 429 || response.status === 503) {
      const header = response.headers.get('Retry-After'), seconds = Number(header)
      const retryAt = header ? Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : Date.parse(header) : undefined
      throw new LyricsRequestError('LRCLIB is busy. Please retry later.', Number.isFinite(retryAt) ? retryAt : Date.now() + 30_000)
    }
    if (!response.ok) throw new LyricsRequestError(`Lyrics lookup failed (${response.status}). Please retry.`)
    const reader = response.body?.getReader()
    let text = ''
    if (reader) {
      const decoder = new TextDecoder(), chunks: string[] = []; let bytes = 0
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('LRCLIB returned too much data.') } chunks.push(decoder.decode(chunk.value, { stream: true })) } }
      finally { reader.releaseLock() }
      text = chunks.join('') + decoder.decode()
    } else { text = await response.text(); if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('LRCLIB returned too much data.') }
    return JSON.parse(text)
  } catch (error) {
    if (timedOut) throw new LyricsRequestError('Lyrics lookup timed out. Playback is unaffected. Please retry.')
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError')
    if (error instanceof TypeError) throw new LyricsRequestError('Online lyrics are unreachable. Use cached lyrics or import an LRC file.')
    throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export async function lookupLyrics(metadata: TrackMetadata, duration: number, signal: AbortSignal) {
  const data = await request('get', { track_name: metadata.title.trim(), artist_name: metadata.artist.trim(), album_name: metadata.album.trim(), duration: duration > 0 && duration <= 3600 ? String(duration) : '' }, signal)
  return data === null ? null : record(data)
}
export async function searchLyrics(title: string, artist: string, signal: AbortSignal) {
  if (!title.trim()) throw new Error('Enter a song title to search.')
  const data = await request('search', { track_name: title.trim(), artist_name: artist.trim() }, signal)
  if (data === null) return []
  if (!Array.isArray(data)) throw new Error('LRCLIB returned invalid search results.')
  return data.slice(0, 20).map(record)
}
const normalized = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
export function isReliableMatch(result: LyricsResult, metadata: TrackMetadata, duration: number) {
  return normalized(result.trackName) === normalized(metadata.title) && normalized(result.artistName) === normalized(metadata.artist)
    && Number.isFinite(duration) && duration > 0 && Number.isFinite(result.duration) && Math.abs(result.duration - duration) <= 2
    && (!metadata.album.trim() || normalized(result.albumName) === normalized(metadata.album))
}
export function resultDocument(result: LyricsResult): LyricsDocument {
  const source: LyricsDocument['source'] = { kind: 'lrclib', label: 'LRCLIB', providerId: result.id }
  if (result.instrumental) return { kind: 'instrumental', text: '', cues: [], embeddedOffsetMs: 0, warnings: [], source }
  if (result.syncedLyrics) { const document = parseLrc(result.syncedLyrics, source); if (document.cues.length) return document }
  if (result.plainLyrics) return { kind: 'plain', text: result.plainLyrics, cues: [], embeddedOffsetMs: 0, warnings: [], source }
  throw new Error('This version has no usable lyrics.')
}
