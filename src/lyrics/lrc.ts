import type { Track } from '../domain/models'
import type { LyricsCue, LyricsDocument } from './types'

export const MAX_LYRICS_BYTES = 512 * 1024
const MAX_LINES = 10_000
export function parseLrc(text: string, source: LyricsDocument['source']): LyricsDocument {
  if (new TextEncoder().encode(text).length > MAX_LYRICS_BYTES) throw new Error('Lyrics exceed the 512 KiB limit.')
  if (text.includes('\0')) throw new Error('This lyrics file contains invalid text.')
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  if (lines.length > MAX_LINES) throw new Error('Lyrics exceed the 10,000-line limit.')
  const offsetTags = [...text.matchAll(/\[offset:([+-]?\d+)\]/gi)]
  const embeddedOffsetMs = offsetTags.length ? Number(offsetTags.at(-1)![1]) : 0
  if (!Number.isSafeInteger(embeddedOffsetMs) || Math.abs(embeddedOffsetMs) > 86_400_000) throw new Error('This lyrics file has an invalid timing offset.')
  const timed: LyricsCue[] = [], plain: string[] = []
  let invalid = 0
  for (const line of lines) {
    const stamps = [...line.matchAll(/\[(\d{1,5}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    const content = line.replace(/\[\d{1,5}:\d{2}(?:[.:]\d{1,3})?\]/g, '').replace(/<\d{1,5}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim()
    if (!stamps.length) {
      if (line.trim() && !/^\s*\[[a-z]+:.*\]\s*$/i.test(line)) plain.push(line.trim())
      continue
    }
    for (const stamp of stamps) {
      const seconds = Number(stamp[2]), fraction = Number(`0.${stamp[3] ?? '0'}`)
      const timeMs = Math.round((Number(stamp[1]) * 60 + seconds + fraction) * 1000) - embeddedOffsetMs
      if (seconds >= 60 || timeMs > 86_400_000) { invalid++; continue }
      timed.push({ timeMs, text: content })
    }
  }
  timed.sort((a, b) => a.timeMs - b.timeMs)
  const cues: LyricsCue[] = []
  for (const cue of timed) {
    const previous = cues.at(-1)
    if (previous?.timeMs === cue.timeMs) previous.text = [previous.text, cue.text].filter(Boolean).join('\n')
    else cues.push({ ...cue })
  }
  const warnings = invalid ? [`${invalid} invalid timestamp${invalid === 1 ? '' : 's'} ignored.`] : []
  return { kind: cues.length ? 'synced' : 'plain', text: cues.length ? text.replace(/^\uFEFF/, '') : plain.join('\n'), cues, embeddedOffsetMs, warnings, source }
}
export function cueIndex(cues: LyricsCue[], positionMs: number, correctionMs = 0) {
  let lo = 0, hi = cues.length
  const time = positionMs - correctionMs
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (cues[mid].timeMs <= time) lo = mid + 1; else hi = mid }
  return lo - 1
}
export function exportLrc(document: LyricsDocument, correctionMs: number) {
  if (document.kind !== 'synced') throw new Error('Only synchronized lyrics can be downloaded as LRC.')
  if (!correctionMs) return document.text
  // Positive LRC offsets advance lyrics; positive user corrections delay them.
  const withoutOffset = document.text.replace(/\[offset:[+-]?\d+\]\s*(?:\r\n|\n|\r)?/gi, '')
  return `[offset:${document.embeddedOffsetMs - correctionMs}]\n${withoutOffset}`
}
export function trackFingerprint(track: Track) { return JSON.stringify([track.path, track.size, track.lastModified]) }
export function localCandidates(track: Track, files: string[], tracks: Track[]) {
  const dot = track.path.lastIndexOf('.'), stem = dot < 0 ? track.path : track.path.slice(0, dot)
  const paths = files.filter(path => /\.lrc$/i.test(path) && (path.slice(0, -4) === stem || path.slice(0, -4) === track.path))
  const sharedStem = tracks.some(other => other.id !== track.id && other.path.replace(/\.[^.]+$/, '') === stem)
  const ambiguous = paths.length > 1 || paths.length === 1 && sharedStem && paths[0].slice(0, -4) === stem
  return { paths, ambiguous }
}
