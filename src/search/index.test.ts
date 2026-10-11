import { describe, expect, it } from 'vitest'
import { SearchIndex } from './index'
import type { SearchLibrary, SearchTrack } from './types'
const song = (id: string, title: string, artist = '', album = ''): SearchTrack => ({ id, title, artist, album, path: `Disc/${id}.flac` })
const fixture = (): SearchLibrary => ({ id: 'a', name: 'My music', tracks: [song('first', 'Café Lights', 'Björk', 'Evening'), song('second', 'Evening', 'Someone else', 'Live')], playlists: [{ id: 'mix', path: 'Road trip.m3u8', name: 'Road trip.m3u8' }] })
describe('global music search', () => {
  it('matches accents, multiple fields, paths and arbitrary playlist filenames', () => {
    const index = new SearchIndex(); index.upsert(fixture())
    expect(index.search('cafe bjork').items.map(item => item.value)).toEqual(['first'])
    expect(index.search('disc first').items[0].value).toBe('first')
    expect(index.search('road trip').items[0]).toMatchObject({ kind: 'playlist', title: 'Road trip', value: 'Road trip.m3u8' })
    expect(index.search('something absent').items).toEqual([])
  })
  it('ranks title matches above album or artist matches and searches across libraries', () => {
    const index = new SearchIndex(); index.upsert(fixture()); index.upsert({ ...fixture(), id: 'b', name: 'Other library' })
    const matches = index.search('evening').items.filter(item => item.kind === 'track')
    expect(matches.map(item => item.value)).toEqual(['second', 'second', 'first', 'first'])
    expect(new Set(matches.map(item => item.key)).size).toBe(4)
    expect(index.search('other library').items.some(item => item.kind === 'library' && item.libraryId === 'b')).toBe(true)
  })
  it('explores albums, artists, libraries and explicit playlist membership within search', () => {
    const index = new SearchIndex(); index.upsert(fixture())
    for (const scope of [
      { kind: 'artist' as const, value: 'Björk' },
      { kind: 'album' as const, value: JSON.stringify(['Evening', 'Björk']) },
      { kind: 'playlist' as const, trackIds: ['first', 'first', 'missing'] },
    ]) expect(index.search('', { ...scope, libraryId: 'a', title: 'Scope' }).items.map(item => item.value)).toEqual(['first'])
    expect(index.search('', { kind: 'library', libraryId: 'a', title: 'Library' }).total).toBe(2)
    expect(index.search('second', { kind: 'playlist', libraryId: 'a', title: 'Playlist', trackIds: ['first'] }).total).toBe(0)
    expect(index.search('', { kind: 'playlist', libraryId: 'a', title: 'Playlist', trackIds: ['second', 'first'] }).items.map(item => item.value)).toEqual(['second', 'first'])
  })
  it('updates renamed tracks and metadata, removes stale libraries and does not duplicate documents', () => {
    const index = new SearchIndex(), library = fixture(); index.upsert(library); index.upsert(library)
    expect(index.search('cafe').total).toBe(1)
    index.upsert({ ...library, tracks: [song('first', 'New name', 'New artist', 'New album')] })
    expect(index.search('cafe').total).toBe(0)
    expect(index.search('evening').total).toBe(0)
    expect(index.search('new artist').items.some(item => item.kind === 'artist')).toBe(true)
    index.retain([]); expect(index.search('').total).toBe(0)
  })
  it('bounds results for large libraries and offers collections before a query', () => {
    const index = new SearchIndex()
    index.upsert({ id: 'large', name: 'Large', playlists: [], tracks: Array.from({ length: 10_000 }, (_, i) => song(String(i), `Song ${i}`, 'Artist', 'Album')) })
    expect(index.search('song').total).toBe(10_000)
    expect(index.search('song').items).toHaveLength(12)
    expect(index.search('').items.map(item => item.kind)).toEqual(['library'])
    expect(index.search('', { kind: 'library', libraryId: 'large', title: 'Large' }).items).toHaveLength(24)
    expect(index.search('Song 9999').items[0].title).toBe('Song 9999')
  })
  it('treats punctuation and script characters as text and supports non-Latin titles', () => {
    const index = new SearchIndex(); index.upsert({ ...fixture(), tracks: [song('x', 'Позови меня с собой'), song('y', '<script>alert(1)</script>')] })
    expect(index.search('позови').items[0].value).toBe('x')
    expect(index.search('alert').items[0].title).toBe('<script>alert(1)</script>')
  })
})
