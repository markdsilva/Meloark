export type MetadataStatus = 'pending' | 'loading' | 'ready' | 'error'
export type PlaybackSupport = 'unknown' | 'likely' | 'unsupported' | 'failed'
export interface TrackMetadata {
  title: string
  artist: string
  album: string
  duration?: number
  codec?: string
  container?: string
  codecProfile?: string
  bitrate?: number
  bitrateKind?: 'reported' | 'constant' | 'average'
  sampleRate?: number
  bitsPerSample?: number
  channels?: number
  lossless?: boolean
  technicalVersion?: number
  artwork?: Blob
  error?: string
}
export interface Track {
  id: string
  path: string
  filename: string
  size: number
  lastModified: number
  index: number | null
  metadataStatus: MetadataStatus
  metadata: TrackMetadata
  support: PlaybackSupport
}
export interface PlaylistEntry {
  id: string
  raw: string
  prelude: string[]
  trackId?: string
  path?: string
  issue?: string
  suggestions?: string[]
}
export interface PlaylistDocument {
  path: string
  bom: boolean
  newline: '\n' | '\r\n' | '\r'
  header: string[]
  trailing: string[]
  entries: PlaylistEntry[]
  issues: string[]
  encoding: 'utf-8' | 'windows-1252'
  inspected: boolean
}
export interface HistoryCommand { before: PlaylistEntry[]; after: PlaylistEntry[]; label: string }
export interface PlaylistSession {
  id: string
  name: string
  document: PlaylistDocument
  entries: PlaylistEntry[]
  saved: PlaylistEntry[]
  baseline: Uint8Array | null
  undo: HistoryCommand[]
  redo: HistoryCommand[]
  revision: number
  status: 'new' | 'saved' | 'dirty' | 'saving' | 'error' | 'unverified' | 'download'
  error?: string
  expectedAttempt?: string
}
let idCounter = 0
export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID()
  // Portable mode also works on origins where secure-context UUIDs are absent.
  if (typeof globalThis.crypto?.getRandomValues === 'function') return [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2)}`
}
export const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'aif', 'aiff', 'wma', 'm4b'])
export const extension = (path: string) => path.split('.').at(-1)?.toLowerCase() ?? ''
export const filename = (path: string) => path.split('/').at(-1) ?? path
export const dirname = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0)
export const entrySignature = (entries: PlaylistEntry[]) => JSON.stringify(entries.map(e => [e.id, e.path, e.raw, e.prelude]))
export const isDirty = (session: PlaylistSession) => session.baseline === null || entrySignature(session.entries) !== entrySignature(session.saved)
