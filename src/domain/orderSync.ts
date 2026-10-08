import { dirname, filename, newId, type Track, type PlaylistEntry } from './models'
import { normalizeRelative, relativeReference, resolveReference } from '../playlists/paths'
import { MAX_BYTES, MAX_LINES } from '../playlists/codec'

export const JOURNAL_PATH = '.meloark-order-sync.json'
export const syncKey = (value: string) => value.normalize('NFC').toLocaleLowerCase('en-US')
export const inFolder = (folder: string, name: string) => folder ? `${folder}/${name}` : name
export function filenameStem(path: string) {
  const name = filename(path), dot = name.lastIndexOf('.')
  // Only strip an unambiguous numeric prefix followed by a separator.
  return name.slice(0, dot).replace(/^\d+[ ._-]+/, '')
}
export function validFilename(name: string) {
  return !!name && !/[<>:"/\\|?*]/.test(name) && ![...name].some(char => char.charCodeAt(0) < 32) && !/[. ]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) && name.length <= 240
}
export interface RenameIntent { trackId?: string; source: string; temporary: string; target: string }
export function planNames(entries: PlaylistEntry[], tracks: Record<string, Track>, folder: string, stems: Record<string, string>, files: string[], token = newId()): RenameIntent[] {
  const inventory = Object.values(tracks).filter(track => dirname(track.path) === folder)
  const ids = entries.map(entry => entry.trackId)
  const idSet = new Set(ids), fileKeys = new Map<string, string[]>()
  for (const path of files) { const key = syncKey(path); fileKeys.set(key, [...fileKeys.get(key) ?? [], path]) }
  if (!inventory.length || ids.some(id => !id) || idSet.size !== ids.length || ids.length !== inventory.length || inventory.some(track => !idSet.has(track.id))) throw new Error('Filename sync needs every audio file in exactly one folder, once each. Refresh and review the folder inventory.')
  // Retain the folder's existing padding (001 stays 001) instead of renaming an
  // already numbered collection merely to change the number of leading zeros.
  const width = inventory.reduce((width, track) => Math.max(width, filename(track.path).match(/^(\d+)[ ._-]+/)?.[1].length ?? 0), Math.max(2, String(entries.length).length))
  const targets = new Set<string>(), sources = new Set<string>(), intents: RenameIntent[] = []
  entries.forEach((entry, index) => {
    const track = tracks[entry.trackId!]
    if (!track || entry.issue || entry.path !== track.path || dirname(track.path) !== folder) throw new Error('The track inventory changed. Refresh before syncing.')
    const suffix = filename(track.path).slice(filename(track.path).lastIndexOf('.'))
    const name = `${String(index + 1).padStart(width, '0')} - ${stems[track.id] ?? filenameStem(track.path)}${suffix}`
    if (!validFilename(name)) throw new Error(`A filename cannot be numbered safely on Windows: ${name}`)
    const target = inFolder(folder, name), key = syncKey(target)
    if (targets.has(key)) throw new Error('Numbered filenames collide after case or Unicode normalization.')
    targets.add(key); sources.add(syncKey(track.path))
    if (target !== track.path) {
      intents.push({ trackId: track.id, source: track.path, target, temporary: inFolder(folder, `.meloark-${token}-${index}${suffix}`) })
      const sidecar = track.path.slice(0, -suffix.length) + '.lrc'
      const candidates = fileKeys.get(syncKey(sidecar)) ?? []
      if (candidates.length > 1) throw new Error(`Ambiguous lyric sidecars: ${sidecar}`)
      if (candidates.length) {
        const lyricTarget = target.slice(0, -suffix.length) + '.lrc'
        intents.push({ source: candidates[0], target: lyricTarget, temporary: inFolder(folder, `.meloark-${token}-${index}.lrc`) })
        sources.add(syncKey(candidates[0])); targets.add(syncKey(lyricTarget))
      }
    }
  })
  if (new Set(files.map(syncKey)).size !== files.length) throw new Error('The library contains case or Unicode-equivalent paths. Resolve them before filename sync.')
  for (const path of files) if (targets.has(syncKey(path)) && !sources.has(syncKey(path))) throw new Error(`An unrelated file occupies a target name: ${path}`)
  for (const intent of intents) if (fileKeys.has(syncKey(intent.temporary))) throw new Error('A temporary rename path already exists. Retry after recovery.')
  return intents
}

// Patch only reference lines. Retain comments, duplicate occurrences, whitespace,
// BOM, mixed line endings and legacy encodings byte-for-byte elsewhere.
export function patchReferences(bytes: Uint8Array, playlistPath: string, paths: ReadonlySet<string>, mapping: ReadonlyMap<string, string>): Uint8Array {
  if (bytes.length > MAX_BYTES) throw new Error(`Cannot safely inspect ${playlistPath}: exceeds 16 MiB.`)
  let encoding: 'utf-8' | 'windows-1252' = 'utf-8', text: string
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { if (/\.m3u8$/i.test(playlistPath)) throw new Error(`Invalid UTF-8 in ${playlistPath}.`); encoding = 'windows-1252'; text = new TextDecoder(encoding).decode(bytes) }
  if (text.split(/\r\n|\r|\n/).length > MAX_LINES) throw new Error(`Cannot safely inspect ${playlistPath}: too many lines.`)
  const encode = (value: string) => {
    if (encoding === 'utf-8') return new TextEncoder().encode(value)
    const table = new Map<string, number>()
    for (let i = 0; i < 256; i++) table.set(new TextDecoder('windows-1252').decode(new Uint8Array([i])), i)
    return new Uint8Array([...value].map(char => { const byte = table.get(char); if (byte === undefined) throw new Error(`A repaired path cannot be encoded in ${playlistPath}. Convert that playlist to UTF-8 first.`); return byte }))
  }
  const pieces: Uint8Array[] = []; let offset = 0
  for (const line of text.split(/(?<=\n)|(?<=\r)(?!\n)/)) {
    const old = encode(line), ending = line.match(/(?:\r\n|\r|\n)$/)?.[0] ?? ''
    const body = line.slice(0, line.length - ending.length), trimmed = body.replace(/^\uFEFF/, '').trim()
    let replacement: string | undefined
    if (trimmed && !trimmed.startsWith('#')) {
      const quoted = trimmed.startsWith('"') && trimmed.endsWith('"'), raw = quoted ? trimmed.slice(1, -1) : trimmed
      const resolved = resolveReference(raw, playlistPath, paths)
      if (resolved.path && mapping.has(resolved.path)) {
        let reference = relativeReference(mapping.get(resolved.path)!, playlistPath)
        if (raw.includes('\\') && !raw.includes('/')) reference = reference.replaceAll('/', '\\')
        replacement = body.slice(0, body.indexOf(trimmed)) + (quoted ? `"${reference}"` : reference) + body.slice(body.indexOf(trimmed) + trimmed.length) + ending
      } else if (resolved.issue) {
        const candidate = normalizeRelative(inFolder(dirname(playlistPath), raw.replaceAll('\\', '/')))
        const affected = [...mapping.keys()].some(path => candidate && syncKey(path) === syncKey(candidate)) || (/^(?:[a-z]:|[\\/])/i.test(raw) && [...mapping.keys()].some(path => syncKey(filename(path)) === syncKey(raw.replaceAll('\\', '/').split('/').at(-1) ?? '')))
        if (affected) throw new Error(`An ambiguous reference in ${playlistPath} may point to a renamed track. Resolve it first: ${raw}`)
      }
    }
    pieces.push(replacement === undefined ? bytes.slice(offset, offset + old.length) : encode(replacement)); offset += old.length
  }
  if (offset !== bytes.length) throw new Error(`Cannot preserve the encoding of ${playlistPath}.`)
  const result = new Uint8Array(pieces.reduce((n, piece) => n + piece.length, 0)); let position = 0
  for (const piece of pieces) { result.set(piece, position); position += piece.length }
  return result
}
