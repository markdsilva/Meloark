export interface LyricsCue { timeMs: number; text: string }
export interface LyricsDocument {
  kind: 'synced' | 'plain' | 'instrumental'
  text: string
  cues: LyricsCue[]
  embeddedOffsetMs: number
  warnings: string[]
  source: { kind: 'local' | 'import' | 'lrclib'; label: string; path?: string; providerId?: number }
}
export interface LyricsRecord {
  trackId: string
  libraryId: string
  fingerprint: string
  document: LyricsDocument
  correctionMs: number
  selected: boolean
  savedAt: number
}
