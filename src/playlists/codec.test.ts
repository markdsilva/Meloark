import { describe, it, expect } from 'vitest'
import { EncodingError, MAX_BYTES, MAX_LINES, parsePlaylist, serializePlaylist } from './codec'
import { normalizeRelative, relativeReference, resolveReference } from './paths'
const bytes = (text: string) => new TextEncoder().encode(text)
const tracks = new Map([['Album/Été.mp3', 'a'], ['#song.mp3', 'b'], ['Album/next.flac', 'c']])
describe('M3U8 codec', () => {
  it('preserves duplicates, attached comments, BOM and CRLF while reordering', () => {
    const doc = parsePlaylist(bytes('\ufeff#EXTM3U\r\n#EXTINF:5,Été\r\nÉté.mp3\r\n#comment\r\nnext.flac\r\nÉté.mp3\r\n'), 'Album/list.m3u8', tracks)
    expect(doc.entries.map(e => e.trackId)).toEqual(['a', 'c', 'a'])
    expect(new Set(doc.entries.map(e => e.id)).size).toBe(3)
    const rendered = new TextDecoder('utf-8', { ignoreBOM: true }).decode(serializePlaylist(doc, [doc.entries[1], doc.entries[0], doc.entries[2]]))
    expect(rendered).toContain('#comment\r\nnext.flac\r\n#EXTINF:5,Été\r\nÉté.mp3')
    expect(rendered.startsWith('\ufeff')).toBe(true)
  })
  it.each(['\n', '\r\n', '\r'])('parses %j newline and empty documents', newline => {
    const doc = parsePlaylist(bytes(`#EXTM3U${newline}`), 'list.m3u8', tracks)
    expect(doc.entries).toEqual([])
    expect(doc.newline).toBe(newline)
  })
  it('resolves nested paths and safe parent references, preserving Unicode', () => {
    expect(resolveReference('../Album/Été.mp3', 'Lists/list.m3u8', new Set(tracks.keys())).path).toBe('Album/Été.mp3')
    expect(relativeReference('Album/Été.mp3', 'Lists/list.m3u8')).toBe('../Album/Été.mp3')
    expect(relativeReference('#song.mp3', 'list.m3u8')).toBe('./#song.mp3')
  })
  it.each(['../../x.mp3', 'https://example.com/x.mp3', 'C:\\Music\\x.mp3', '/Music/x.mp3', 'missing.mp3', 'Album/été.mp3'])('retains unresolved %s and blocks writing', raw => {
    const doc = parsePlaylist(bytes(raw), 'list.m3u8', tracks)
    expect(doc.entries).toHaveLength(1)
    expect(doc.entries[0].issue).toBeTruthy()
    expect(() => serializePlaylist(doc, doc.entries)).toThrow()
  })
  it('reports separator ambiguity', () => {
    const paths = new Set(['A\\B.mp3', 'A/B.mp3'])
    expect(resolveReference('A\\B.mp3', 'list.m3u8', paths).issue).toContain('Ambiguous')
  })
  it('rejects HLS and unknown directives', () => {
    for (const tag of ['#EXT-X-VERSION:3', '#EXTVLCOPT:foo']) {
      const doc = parsePlaylist(bytes(tag), 'list.m3u8', tracks)
      expect(() => serializePlaylist(doc, doc.entries)).toThrow()
    }
  })
  it('requires explicit legacy decoding and never permits non-UTF8 M3U8', () => {
    const invalid = new Uint8Array([0xe9, 0x2e, 0x6d, 0x70, 0x33])
    expect(() => parsePlaylist(invalid, 'x.m3u', tracks)).toThrow(EncodingError)
    expect(parsePlaylist(invalid, 'x.m3u', tracks, 'windows-1252').entries[0].raw).toBe('é.mp3')
    expect(() => parsePlaylist(invalid, 'x.m3u8', tracks, 'windows-1252')).toThrow()
  })
  it('does not silently truncate oversize documents', () => {
    expect(parsePlaylist(new Uint8Array(MAX_BYTES + 1), 'x.m3u8', tracks).inspected).toBe(false)
    expect(parsePlaylist(bytes('\n'.repeat(MAX_LINES)), 'x.m3u8', tracks).inspected).toBe(false)
  })
  it('rejects unsafe serialized filenames', () => {
    expect(normalizeRelative('a/../../b')).toBeNull()
    expect(() => relativeReference('bad\nname.mp3', 'list.m3u8')).toThrow()
  })
})
