import { describe, it, expect } from 'vitest'
import { PlaybackQueue } from './queue'
const entries = ['a', 'b', 'c'].map(id => ({ id, raw: 'same.mp3', prelude: [], trackId: 'same' }))
describe('playback queue', () => {
  it('keeps duplicate track occurrences distinct', () => {
    const queue = new PlaybackQueue(); queue.reconcile(entries); queue.start('a')
    expect(queue.next()).toBe('b')
    expect(queue.next()).toBe('c')
    expect(queue.next()).toBeNull()
  })
  it('does not reset the playing occurrence on reorder', () => {
    const queue = new PlaybackQueue(); queue.reconcile(entries); queue.start('b')
    expect(queue.reconcile([...entries].reverse())).toBe('b')
    expect(queue.next()).toBe('a')
  })
  it('advances to a surviving successor when the current entry is removed', () => {
    const queue = new PlaybackQueue(); queue.reconcile(entries); queue.start('b')
    expect(queue.reconcile([entries[0], entries[2]])).toBe('c')
    expect(queue.reconcile([])).toBeNull()
  })
  it('manual next bypasses repeat-one and unavailable tracks cannot loop', () => {
    const queue = new PlaybackQueue(); queue.reconcile(entries); queue.start('a'); queue.repeat = 'one'
    expect(queue.next(true)).toBe('a')
    expect(queue.next()).toBe('b')
    queue.repeat = 'all'; queue.unavailable = new Set(['a', 'b', 'c'])
    expect(queue.next(true)).toBeNull()
  })
  it('shuffle traverses a cycle once and previous uses history', () => {
    const queue = new PlaybackQueue(() => 0); queue.reconcile(entries); queue.start('a'); queue.setShuffle(true)
    const second = queue.next(), third = queue.next()
    expect(new Set(['a', second, third]).size).toBe(3)
    expect(queue.next()).toBeNull()
    expect(queue.previous()).toBe(second)
    expect(queue.entries).toEqual(entries)
  })
})
