import { newId, type PlaylistDocument, type PlaylistEntry } from '../domain/models'
import { relativeReference, resolveReference } from './paths'

export const MAX_BYTES = 16 * 1024 * 1024
export const MAX_LINES = 100_000
export class EncodingError extends Error {}
export function emptyDocument(path: string): PlaylistDocument {
  return { path, bom: false, newline: '\n', header: ['#EXTM3U'], trailing: [], entries: [], issues: [], inspected: true, encoding: 'utf-8' }
}
export function parsePlaylist(bytes: Uint8Array, path: string, tracks: ReadonlyMap<string, string>, encoding: 'utf-8' | 'windows-1252' = 'utf-8'): PlaylistDocument {
  const document = emptyDocument(path)
  if (bytes.length > MAX_BYTES) return { ...document, inspected: false, issues: ['Playlist exceeds the 16 MiB inspection limit.'] }
  if (path.toLowerCase().endsWith('.m3u8') && encoding !== 'utf-8') throw new EncodingError('M3U8 files must use UTF-8.')
  let text: string
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  catch { throw new EncodingError('Invalid UTF-8. Legacy M3U files can be reviewed as Windows-1252.') }
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > MAX_LINES) return { ...document, inspected: false, issues: ['Playlist exceeds the 100,000-line inspection limit.'] }
  document.encoding = encoding
  document.bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  document.newline = text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n'
  document.header = []
  const available = new Set(tracks.keys())
  let pending: string[] = []
  if (lines.at(-1) === '') lines.pop()
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#EXT-X-/i.test(trimmed)) document.issues.push('HLS manifests are not editable music playlists.')
    else if (/^#EXT/i.test(trimmed) && !/^#EXTM3U$/i.test(trimmed) && !/^#EXTINF:/i.test(trimmed)) document.issues.push(`Unknown directive requires a normalized copy: ${trimmed.slice(0, 100)}`)
    if (/^#EXTM3U$/i.test(trimmed) && !document.entries.length) { document.header.push(line); continue }
    if (!trimmed || trimmed.startsWith('#')) { pending.push(line); continue }
    const raw = line.startsWith('"') && line.endsWith('"') ? line.slice(1, -1) : line
    const resolved = resolveReference(raw, path, available)
    document.entries.push({ id: newId(), raw, prelude: pending, ...resolved, trackId: resolved.path ? tracks.get(resolved.path) : undefined })
    pending = []
  }
  document.trailing = pending
  document.issues = [...new Set(document.issues)]
  if (!document.header.length) document.header = ['#EXTM3U']
  return document
}
export function serializePlaylist(document: PlaylistDocument, entries: PlaylistEntry[], target = document.path): Uint8Array {
  if (!document.inspected || document.issues.length) throw new Error(document.issues[0] ?? 'Playlist was not completely inspected.')
  if (!target.toLowerCase().endsWith('.m3u8')) throw new Error('Write targets must be M3U8 files.')
  const lines = [...document.header]
  for (const entry of entries) {
    if (!entry.path || !entry.trackId || entry.issue) throw new Error('Resolve or remove missing references before saving or exporting.')
    lines.push(...entry.prelude, relativeReference(entry.path, target))
  }
  lines.push(...document.trailing)
  if (lines.length > MAX_LINES) throw new Error('Result exceeds the 100,000-line playlist limit.')
  const bytes = new TextEncoder().encode(lines.join(document.newline) + document.newline)
  if (bytes.length > MAX_BYTES) throw new Error('Result exceeds the 16 MiB playlist limit.')
  if (!document.bom) return bytes
  const result = new Uint8Array(bytes.length + 3)
  result.set([0xef, 0xbb, 0xbf]); result.set(bytes, 3)
  return result
}
export function normalizedDocument(document: PlaylistDocument, path: string): PlaylistDocument {
  if (!document.inspected || document.issues.some(issue => issue.startsWith('HLS'))) throw new Error('This document cannot be normalized safely.')
  return { ...emptyDocument(path), entries: document.entries.map(entry => ({ ...entry, prelude: entry.prelude.filter(line => !/^\s*#EXT(?!INF:)/i.test(line)) })) }
}
