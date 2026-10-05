import { create } from 'zustand'
import { sources, useApp } from '../app/store'
import { usePlayer } from '../playback/player'
import { loadLyrics, saveLyrics } from '../platform/persistence/database'
import { exportLrc, localCandidates, MAX_LYRICS_BYTES, parseLrc, trackFingerprint } from './lrc'
import { isReliableMatch, lookupLyrics, LyricsRequestError, resultDocument, searchLyrics, type LyricsResult } from './lrclib'
import type { LyricsDocument, LyricsRecord } from './types'

type OnlinePreference = 'ask' | 'enabled' | 'disabled'
function preference(): OnlinePreference {
  try { const value = localStorage.getItem('trackindex-lyrics-online-v1'); return value === 'enabled' || value === 'disabled' ? value : 'ask' } catch { return 'ask' }
}
interface LyricsState {
  open: boolean; online: OnlinePreference
  status: 'idle' | 'loading' | 'ready' | 'not-found' | 'local-choice' | 'local-only' | 'needs-metadata' | 'error'
  record?: LyricsRecord; localPaths: string[]; results: LyricsResult[]; searching: boolean
  error?: string; notice?: string; cacheError?: string; retryAt?: number
  follow: boolean
}
export const useLyrics = create<LyricsState>(() => ({ open: false, online: preference(), status: 'idle', localPaths: [], results: [], searching: false, follow: true }))
const memory = new Map<string, LyricsRecord>(), writes = new Map<string, { libraryId: string; promise: Promise<void> }>()
const misses = new Set<string>()
let sequence = 0, request: AbortController | undefined
function cancel() { ++sequence; request?.abort(); request = undefined }
export function toggleLyrics() { if (useLyrics.getState().open) closeLyrics(); else useLyrics.setState({ open: true, follow: true, notice: undefined }) }
export function closeLyrics() { cancel(); useLyrics.setState({ open: false, searching: false }) }
export function setLyricsOnline(value: OnlinePreference) {
  cancel()
  try { localStorage.setItem('trackindex-lyrics-online-v1', value) } catch { /* This session still retains the choice. */ }
  useLyrics.setState({ online: value, results: [], searching: false, error: undefined })
}
function current() {
  const { track, context, duration } = usePlayer.getState()
  const library = useApp.getState().libraries.find(item => item.id === context?.libraryId)
  if (!track || !library) return
  const fingerprint = trackFingerprint(track), source = sources.get(library.id)
  const metadataDuration = track.metadata.duration
  const seconds = metadataDuration && Number.isFinite(metadataDuration) ? metadataDuration : duration
  const key = JSON.stringify([track.id, fingerprint, track.metadata.title, track.metadata.titleFromTag, track.metadata.artist, track.metadata.album, seconds])
  return { track, library, source, fingerprint, seconds, key }
}
function begin() {
  cancel()
  const value = current(), token = sequence
  request = new AbortController()
  return { value, signal: request.signal, valid: () => token === sequence && useLyrics.getState().open && current()?.key === value?.key }
}
function remember(record: LyricsRecord) {
  memory.delete(record.trackId); memory.set(record.trackId, record)
  let bytes = [...memory.values()].reduce((total, item) => total + item.document.text.length * 2, 0)
  while ((memory.size > 64 || bytes > 8 * 1024 * 1024) && memory.size > 1) {
    const first = memory.values().next().value!; memory.delete(first.trackId); bytes -= first.document.text.length * 2
  }
}
async function cached(trackId: string) {
  const known = memory.get(trackId)
  if (known) return known
  try { const record = await loadLyrics(trackId); if (record) remember(record); return record }
  catch { useLyrics.setState({ cacheError: 'Lyrics are available for this session. Browser storage is unavailable; download an LRC copy to keep it.' }) }
}
function persist(record: LyricsRecord) {
  remember(record)
  const pending = (writes.get(record.trackId)?.promise ?? Promise.resolve()).then(() => saveLyrics(record)).catch(() => {
    if (useLyrics.getState().record?.trackId === record.trackId) useLyrics.setState({ cacheError: 'Lyrics could not be remembered. They remain available in this session; download an LRC copy to keep them.' })
  })
  writes.set(record.trackId, { libraryId: record.libraryId, promise: pending })
  void pending.finally(() => { if (writes.get(record.trackId)?.promise === pending) writes.delete(record.trackId) })
}
function commit(document: LyricsDocument, selected: boolean, previous?: LyricsRecord) {
  const value = current()
  if (!value) return
  const record: LyricsRecord = { trackId: value.track.id, libraryId: value.library.id, fingerprint: value.fingerprint, document,
    correctionMs: previous?.fingerprint === value.fingerprint && previous.document.text === document.text && JSON.stringify(previous.document.source) === JSON.stringify(document.source) ? previous.correctionMs : 0, selected, savedAt: Date.now() }
  useLyrics.setState({ record, status: 'ready', error: undefined, searching: false, results: [], localPaths: [], follow: true })
  persist(record)
}
async function readLocal(path: string, signal: AbortSignal) {
  const value = current()
  if (!value?.source || !value.library.connected) throw new Error('Reconnect your library to read this LRC file.')
  const file = await value.source.readFile(path)
  signal.throwIfAborted()
  if (file.size > MAX_LYRICS_BYTES) throw new Error('Lyrics exceed the 512 KiB limit.')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) }
  catch { throw new Error('This LRC file is not valid UTF-8. Convert it to UTF-8, then import it again.') }
  signal.throwIfAborted()
  const document = parseLrc(text, { kind: 'local', label: path.split('/').at(-1)!, path })
  if (!document.cues.length && !document.text.trim()) throw new Error('This LRC file has no usable lyrics.')
  return document
}
function failure(error: unknown, valid: () => boolean) {
  if (!valid() || error instanceof DOMException && error.name === 'AbortError') return
  useLyrics.setState({ status: useLyrics.getState().record ? 'ready' : 'error', searching: false,
    error: error instanceof Error ? error.message : 'Lyrics could not be loaded.', retryAt: error instanceof LyricsRequestError ? error.retryAt : undefined })
}
export async function loadCurrentLyrics(retry = false) {
  if (!useLyrics.getState().open || document.visibilityState === 'hidden') return
  const { value, signal, valid } = begin()
  useLyrics.setState({ status: value ? 'loading' : 'idle', record: undefined, error: undefined, notice: undefined, localPaths: [], results: [], searching: false, follow: true })
  if (!value) return
  try {
    const known = await cached(value.track.id)
    if (!valid()) return
    const record = known?.fingerprint === value.fingerprint ? known : undefined
    if (record?.selected) {
      if (record.document.source.kind === 'local' && record.document.source.path && value.library.connected) {
        try { const document = await readLocal(record.document.source.path, signal); if (valid()) commit(document, true, record); return }
        catch (error) { if (!valid()) return; useLyrics.setState({ notice: `Using your cached lyrics copy. ${error instanceof Error ? error.message : 'The local file is unavailable.'}` }) }
      }
      useLyrics.setState({ record, status: 'ready' }); return
    }
    const local = localCandidates(value.track, value.library.files, Object.values(value.library.tracks))
    if (local.ambiguous && value.library.connected) { useLyrics.setState({ status: 'local-choice', localPaths: local.paths }); return }
    if (local.paths.length === 1 && value.library.connected) {
      try { const document = await readLocal(local.paths[0], signal); if (valid()) commit(document, false, record); return }
      catch (error) { if (!valid()) return; useLyrics.setState({ notice: `Local lyrics could not be read. ${error instanceof Error ? error.message : 'Try importing another LRC file.'}` }) }
    }
    if (record) { useLyrics.setState({ record, status: 'ready' }); return }
    if (useLyrics.getState().online !== 'enabled') { useLyrics.setState({ status: 'local-only' }); return }
    if ((useLyrics.getState().retryAt ?? 0) > Date.now()) { useLyrics.setState({ status: 'error', error: 'LRCLIB is busy. Please wait before retrying.' }); return }
    if (!value.track.metadata.titleFromTag || !value.track.metadata.artist.trim() || !value.track.metadata.title.trim() || !value.seconds) { useLyrics.setState({ status: 'needs-metadata' }); return }
    if (misses.has(value.key) && !retry) { useLyrics.setState({ status: 'not-found' }); return }
    const result = await lookupLyrics(value.track.metadata, value.seconds, signal)
    if (!valid()) return
    if (!result || !isReliableMatch(result, value.track.metadata, value.seconds)) {
      misses.add(value.key)
      useLyrics.setState({ status: 'not-found', results: result ? [result] : [], notice: result ? 'A different recording was found. Review it with Find another version.' : undefined }); return
    }
    commit(resultDocument(result), false)
  } catch (error) { failure(error, valid) }
}
export async function chooseLocalLyrics(path: string) {
  const { signal, valid } = begin()
  useLyrics.setState({ status: 'loading', error: undefined })
  try { const document = await readLocal(path, signal); if (valid()) commit(document, true, useLyrics.getState().record) }
  catch (error) { failure(error, valid) }
}
export async function importLyrics(file: File) {
  const { signal, valid } = begin()
  const previous = useLyrics.getState().record
  try {
    if (!/\.lrc$/i.test(file.name)) throw new Error('Choose an .lrc lyrics file.')
    if (file.size > MAX_LYRICS_BYTES) throw new Error('Lyrics exceed the 512 KiB limit.')
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) }
    catch { throw new Error('This LRC file is not valid UTF-8. Convert it to UTF-8, then import it again.') }
    signal.throwIfAborted()
    const document = parseLrc(text, { kind: 'import', label: file.name })
    if (!document.cues.length && !document.text.trim()) throw new Error('This file has no usable lyrics.')
    if (valid()) commit(document, true, previous)
  } catch (error) { failure(error, valid) }
}
export async function findLyrics(title: string, artist: string) {
  if (useLyrics.getState().online !== 'enabled') return
  if ((useLyrics.getState().retryAt ?? 0) > Date.now()) { useLyrics.setState({ error: 'LRCLIB is busy. Please wait before retrying.' }); return }
  const { signal, valid } = begin()
  useLyrics.setState({ searching: true, error: undefined, results: [] })
  try { const results = await searchLyrics(title, artist, signal); if (valid()) useLyrics.setState({ results, searching: false }) }
  catch (error) { failure(error, valid) }
}
export function chooseLyricsResult(result: LyricsResult, expectedTrackId: string) {
  if (!useLyrics.getState().open || current()?.track.id !== expectedTrackId) return
  cancel()
  try { commit(resultDocument(result), true, useLyrics.getState().record) }
  catch (error) { useLyrics.setState({ error: error instanceof Error ? error.message : 'This version cannot be used.' }) }
}
export function correctLyrics(milliseconds: number) {
  const record = useLyrics.getState().record
  if (!record || current()?.track.id !== record.trackId || !Number.isFinite(milliseconds)) return
  const updated = { ...record, correctionMs: Math.max(-60_000, Math.min(60_000, Math.round(milliseconds))), savedAt: Date.now() }
  useLyrics.setState({ record: updated }); persist(updated)
}
export function downloadLyrics() {
  const { record } = useLyrics.getState(), value = current()
  if (!record || !value || record.trackId !== value.track.id) return
  try {
    const text = exportLrc(record.document, record.correctionMs)
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), link = document.createElement('a')
    link.href = url; link.download = value.track.filename.replace(/\.[^.]+$/, '') + '.lrc'
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
    useLyrics.setState({ notice: 'Download requested. Place the LRC beside the matching audio file. Your library files have not been changed.' })
  } catch (error) { useLyrics.setState({ error: error instanceof Error ? error.message : 'Lyrics could not be exported.' }) }
}
export function suspendLyrics() { cancel(); useLyrics.setState({ searching: false }) }
export async function forgetLyricsLibrary(libraryId: string) {
  const records = [...memory.values()].filter(record => record.libraryId === libraryId)
  if (useLyrics.getState().record?.libraryId === libraryId) {
    cancel(); useLyrics.setState({ record: undefined, status: 'idle', localPaths: [], results: [], searching: false })
  }
  // Drain queued cache writes before the database removes this library's records.
  await Promise.all([...writes.values()].filter(write => write.libraryId === libraryId).map(write => write.promise))
  for (const record of records) memory.delete(record.trackId)
}
