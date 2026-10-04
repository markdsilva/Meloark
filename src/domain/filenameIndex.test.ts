import { describe, it, expect } from 'vitest'
import { analyzeIndexes, filenameIndex } from './filenameIndex'
import type { Track } from './models'
const tracks = (paths: string[]) => paths.map(path => ({ path, index: filenameIndex(path).index }) as Track)
describe('filename indexes', () => {
  it.each(['001 - Song.mp3', '001. Song.mp3', '001) Song.flac'])('recognizes %s', path => expect(filenameIndex(path).index).toBe(1))
  it('does not treat an ordinary year/name as an index', () => expect(filenameIndex('1999.mp3').index).toBeNull())
  it('keeps album indexes local and numeric', () => {
    const groups = analyzeIndexes(tracks(['A/010 - Song.mp3', 'A/002 - Song.mp3', 'B/002 - Song.mp3']))
    expect(groups).toHaveLength(2)
    expect(groups[0].tracks[0].index).toBe(2)
    expect(groups.every(group => !group.ambiguous)).toBe(true)
  })
  it('requires review for duplicates, zero, invalid and partially indexed folders', () => {
    for (const paths of [['001 - A.mp3', '001 - B.mp3'], ['000 - A.mp3'], ['999999999999999999999 - A.mp3'], ['001 - A.mp3', 'B.mp3']]) {
      expect(analyzeIndexes(tracks(paths))[0].ambiguous).toBe(true)
    }
  })
  it('bounds huge gap previews', () => {
    const group = analyzeIndexes(tracks(['9000000000 - A.mp3']))[0]
    expect(group.issues[0].length).toBeLessThan(150)
    expect(group.issues[0]).toContain('…')
  })
  it('supports fully indexed and unindexed folders', () => {
    expect(analyzeIndexes(tracks(['001 - A.mp3', '002 - B.mp3']))[0].issues).toEqual([])
    expect(analyzeIndexes(tracks(['A.mp3']))[0].indexed).toBe(0)
  })
})
