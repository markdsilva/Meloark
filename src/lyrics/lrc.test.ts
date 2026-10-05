import { describe, expect, it } from 'vitest'
import { cueIndex, exportLrc, localCandidates, MAX_LYRICS_BYTES, parseLrc, trackFingerprint } from './lrc'
import type { Track } from '../domain/models'
const source = { kind: 'import' as const, label: 'Song.lrc' }
const track = (path: string): Track => ({ id: path, path, filename: path.split('/').at(-1)!, size: 10, lastModified: 5, index: null, metadataStatus: 'ready', support: 'likely', metadata: { title: 'Song', artist: 'Artist', album: '' } })
describe('LRC parsing and synchronization', () => {
  it('handles BOM, newlines, Unicode, fractions, and repeated timestamp tags', () => {
    const document = parseLrc('\uFEFF[ar:Artist]\r\n[00:01.2][00:03.250]Привет\r[00:02:05]世界\n[00:04]Last', source)
    expect(document.kind).toBe('synced')
    expect(document.cues).toEqual([{ timeMs: 1200, text: 'Привет' }, { timeMs: 2050, text: '世界' }, { timeMs: 3250, text: 'Привет' }, { timeMs: 4000, text: 'Last' }])
  })
  it('groups simultaneous lines, preserves breaks, and strips enhanced word timing', () => {
    const document = parseLrc('[00:01.00]First\n[00:01.00]Translation\n[00:02.00]\n[00:03.00]<00:03.00>Some <00:03.50>words', source)
    expect(document.cues).toEqual([{ timeMs: 1000, text: 'First\nTranslation' }, { timeMs: 2000, text: '' }, { timeMs: 3000, text: 'Some words' }])
  })
  it('applies the last embedded offset and user correction with explicit directions', () => {
    const document = parseLrc('[offset:100]\n[offset:+500]\n[00:01.00]Line\n[00:03.00]Next', source)
    expect(document.cues[0].timeMs).toBe(500)
    expect(cueIndex(document.cues, 499)).toBe(-1)
    expect(cueIndex(document.cues, 500)).toBe(0)
    expect(cueIndex(document.cues, 500, 100)).toBe(-1)
    expect(cueIndex(document.cues, 600, 100)).toBe(0)
    expect(cueIndex(document.cues, 2900)).toBe(1)
    expect(cueIndex(document.cues, 0)).toBe(-1)
    const exported = parseLrc(exportLrc(document, 200), source)
    expect(exported.cues.map(cue => cue.timeMs)).toEqual(document.cues.map(cue => cue.timeMs + 200))
    expect(exportLrc(document, 0)).toBe(document.text)
  })
  it('keeps negative cue times and returns the proper cue after forward and backward seeks', () => {
    const document = parseLrc('[offset:1500]\n[00:00.00]Intro\n[00:03.00]Second\n[00:06.00]Third', source)
    expect(cueIndex(document.cues, 0)).toBe(0)
    expect(cueIndex(document.cues, 5000)).toBe(2)
    expect(cueIndex(document.cues, 1600)).toBe(1)
    expect(cueIndex([], 1000)).toBe(-1)
  })
  it('keeps markup as text and falls back to plain lyrics without fabricated timing', () => {
    const document = parseLrc('[ti:Title]\n<script>alert(1)</script>\nPlain words', source)
    expect(document.text).toBe('<script>alert(1)</script>\nPlain words')
    expect(document.kind).toBe('plain')
    expect(document.cues).toEqual([])
    expect(() => exportLrc(document, 0)).toThrow('Only synchronized')
  })
  it('reports malformed timestamps and refuses unsafe or oversized input', () => {
    expect(parseLrc('[00:99.00]Bad\n[00:01]Good', source).warnings).toHaveLength(1)
    expect(() => parseLrc('a\0b', source)).toThrow('invalid text')
    expect(() => parseLrc('x'.repeat(MAX_LYRICS_BYTES + 1), source)).toThrow('512 KiB')
    expect(() => parseLrc('\n'.repeat(10_001), source)).toThrow('10,000-line')
    expect(() => parseLrc('[offset:999999999999999999999]', source)).toThrow('invalid timing offset')
  })
})
describe('local lyrics identity and matching', () => {
  it('matches exact stems in the same folder, including extension-specific sidecars', () => {
    const audio = track('One/Song.flac')
    expect(localCandidates(audio, ['Two/Song.lrc', 'One/song.lrc', 'One/Song.LRC'], [audio])).toEqual({ paths: ['One/Song.LRC'], ambiguous: false })
    expect(localCandidates(audio, ['One/Song.flac.lrc'], [audio])).toEqual({ paths: ['One/Song.flac.lrc'], ambiguous: false })
  })
  it('requires review for multiple files and shared names across audio formats', () => {
    const audio = track('Song.flac'), other = track('Song.mp3')
    expect(localCandidates(audio, ['Song.lrc', 'Song.flac.lrc'], [audio]).ambiguous).toBe(true)
    expect(localCandidates(audio, ['Song.lrc'], [audio, other]).ambiguous).toBe(true)
    expect(localCandidates(audio, ['Song.flac.lrc'], [audio, other]).ambiguous).toBe(false)
  })
  it('invalidates lyrics when the file changes, independently of playlist occurrence identity', () => {
    const audio = track('Song.flac')
    expect(trackFingerprint(audio)).not.toBe(trackFingerprint({ ...audio, size: 11 }))
    expect(trackFingerprint(audio)).not.toBe(trackFingerprint({ ...audio, lastModified: 6 }))
    expect(trackFingerprint(audio)).toBe(trackFingerprint({ ...audio, id: 'other occurrence' }))
  })
})
