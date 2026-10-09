import { describe, expect, it } from 'vitest'
import { planNames, planNumberRemoval, patchReferences, filenameStem } from '../../src/domain/orderSync'
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
  it('keeps three-digit padding in an already numbered folder', () => {
    const a = track('a', '001 - Alpha.flac'), b = track('b', '002 - Beta.flac')
    expect(planNames(entries(a, b), { a, b }, '', {}, [a.path, b.path])).toEqual([])
    expect(planNames(entries(b, a), { a, b }, '', {}, [a.path, b.path]).map(move => move.target)).toEqual(['001 - Beta.flac', '002 - Alpha.flac'])
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
describe('reviewed filename number removal', () => {
  it('removes one prefix, preserves numeric titles and extension case, and limits changes to the selected folder', () => {
    const tracks = [track('a', 'Music/001 - 99 Luftballons.FLAC'), track('b', 'Music/1984.mp3'), track('c', 'Other/02 - Stay.mp3')]
    const moves = planNumberRemoval(Object.fromEntries(tracks.map(track => [track.id, track])), 'Music', [...tracks.map(track => track.path), 'Music/001 - 99 Luftballons.LRC'], 'test')
    expect(moves.map(move => [move.source, move.target])).toEqual([['Music/001 - 99 Luftballons.FLAC', 'Music/99 Luftballons.FLAC'], ['Music/001 - 99 Luftballons.LRC', 'Music/99 Luftballons.LRC']])
  })
  it.each([['01 - Same.mp3', '02 - Same.mp3'], ['01 - SAME.mp3', '02 - same.mp3'], ['01 - é.mp3', '02 - e\u0301.mp3']])('rejects duplicate restored names: %s / %s', (first, second) => {
    const a = track('a', first), b = track('b', second)
    expect(() => planNumberRemoval({ a, b }, '', [first, second])).toThrow(/duplicate filenames/)
  })
  it('rejects occupied targets and case-equivalent inventories, including lyric collisions', () => {
    const a = track('a', '01 - Alpha.mp3')
    expect(() => planNumberRemoval({ a }, '', [a.path, 'ALPHA.mp3'])).toThrow(/existing file/)
    expect(() => planNumberRemoval({ a }, '', [a.path, '01 - Alpha.lrc', 'ALPHA.LRC'])).toThrow(/existing file/)
    expect(() => planNumberRemoval({ a }, '', [a.path, '01 - Alpha.lrc', '01 - Alpha.LRC'])).toThrow(/equivalent paths/)
  })
  it('rejects shared or colliding lyric sidecars even when audio extensions differ', () => {
    const a = track('a', '01 - Song.mp3'), b = track('b', '01 - Song.flac')
    expect(() => planNumberRemoval({ a, b }, '', [a.path, b.path, '01 - Song.lrc'])).toThrow(/duplicate filenames/)
  })
  it.each(['01 - CON.mp3', '01 - bad:name.mp3', '01 - .mp3'])('rejects unsafe or empty restored names: %s', path => {
    const a = track('a', path)
    expect(() => planNumberRemoval({ a }, '', [path])).toThrow(/Windows|empty filename/)
  })
  it('produces no changes for an unnumbered folder', () => {
    const a = track('a', 'Alpha.mp3')
    expect(planNumberRemoval({ a }, '', [a.path])).toEqual([])
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
