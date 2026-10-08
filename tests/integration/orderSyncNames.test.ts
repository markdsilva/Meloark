import { describe, expect, it } from 'vitest'
import { planNames, patchReferences, filenameStem } from '../../src/domain/orderSync'
import type { PlaylistEntry, Track } from '../../src/domain/models'

const track = (id: string, path: string): Track => ({ id, path, filename: path.split('/').at(-1)!, size: 1, lastModified: 1, index: null, support: 'likely', metadataStatus: 'ready', metadata: { title: id, artist: '', album: '' } })
const a = track('a', 'Music/01 - Alpha.mp3'), b = track('b', 'Music/02 - Beta.flac')
const entries = (...tracks: Track[]): PlaylistEntry[] => tracks.map(track => ({ id: `entry-${track.id}`, trackId: track.id, path: track.path, raw: track.path, prelude: [] }))
describe('folder order plans', () => {
  it('numbers a whole folder and matches lyric sidecars without changing track IDs', () => {
    const moves = planNames(entries(b, a), { a, b }, 'Music', { a: 'Alpha', b: 'Beta' }, [a.path, b.path, 'Music/01 - Alpha.lrc'], 'test')
    expect(moves.map(move => [move.trackId, move.source, move.target])).toEqual([
      ['b', b.path, 'Music/01 - Beta.flac'], ['a', a.path, 'Music/02 - Alpha.mp3'], [undefined, 'Music/01 - Alpha.lrc', 'Music/02 - Alpha.lrc'],
    ])
    expect(moves.every(move => move.temporary.includes('.meloark-test-'))).toBe(true)
    expect(filenameStem('099_A song.mp3')).toBe('A song')
    expect(filenameStem('1984.mp3')).toBe('1984')
  })
  it('does no rename work for unchanged numbered order', () => {
    expect(planNames(entries(a, b), { a, b }, 'Music', { a: 'Alpha', b: 'Beta' }, [a.path, b.path])).toEqual([])
  })
  it.each([entries(a), entries(a, a), entries(a, track('outside', 'Elsewhere/Beta.mp3'))].map(rows => [rows]))('rejects subsets, duplicates and multiple folders', rows => {
    expect(() => planNames(rows, { a, b }, 'Music', {}, [a.path, b.path])).toThrow(/every audio file/)
  })
  it('rejects target collisions, case aliases, and unsafe names', () => {
    expect(() => planNames(entries(b, a), { a, b }, 'Music', { a: 'Alpha', b: 'Beta' }, [a.path, b.path, 'Music/01 - beta.FLAC'])).toThrow(/unrelated file/)
    expect(() => planNames(entries(a, b), { a, b }, 'Music', {}, [a.path, b.path, 'Music/01 - ALPHA.mp3'])).toThrow(/equivalent paths/)
    expect(() => planNames(entries(a, b), { a, b }, 'Music', { a: 'bad:name' }, [a.path, b.path])).toThrow(/Windows/)
  })
})
describe('dependent playlist reference repair', () => {
  const paths = new Set([a.path, b.path]), mapping = new Map([[a.path, 'Music/02 - Alpha.mp3']])
  const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  it('preserves duplicate occurrences, BOM, quotes, comments and mixed endings', () => {
    const text = '\uFEFF#EXTM3U\r\n#EXTINF:1,Title\n"Music/01 - Alpha.mp3"\r\nMusic/01 - Alpha.mp3\rMusic/02 - Beta.flac\n#tail'
    expect(decode(patchReferences(new TextEncoder().encode(text), 'List.m3u8', paths, mapping))).toBe(text.replaceAll('01 - Alpha', '02 - Alpha'))
  })
  it('preserves legacy bytes and Windows separators', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('#comment '), 0xe9, ...new TextEncoder().encode('\r\nMusic\\01 - Alpha.mp3\r\n')])
    const patched = patchReferences(bytes, 'Legacy.m3u', paths, mapping)
    expect(patched[9]).toBe(0xe9)
    expect(new TextDecoder('windows-1252').decode(patched)).toBe('#comment é\r\nMusic\\02 - Alpha.mp3\r\n')
  })
  it('leaves unrelated unresolved references untouched and blocks affected ambiguous ones', () => {
    const bytes = new TextEncoder().encode('#EXTM3U\nmissing.mp3\nhttps://example.org/audio.mp3\n')
    expect([...patchReferences(bytes, 'List.m3u8', paths, mapping)]).toEqual([...bytes])
    for (const reference of ['music/01 - alpha.mp3', 'C:\\Music\\01 - Alpha.mp3']) expect(() => patchReferences(new TextEncoder().encode(reference), 'List.m3u8', paths, mapping)).toThrow(/ambiguous reference/)
  })
})
