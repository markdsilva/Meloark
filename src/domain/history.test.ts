import { describe, it, expect } from 'vitest'
import { edit, moveEntries, travel } from './history'
import { isDirty, type PlaylistSession } from './models'
import { emptyDocument } from '../playlists/codec'

const entries = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, raw: `${id}.mp3`, path: `${id}.mp3`, trackId: id, prelude: [] }))
const session = (): PlaylistSession => ({ id: 'p', name: 'p', document: emptyDocument('p.m3u8'), entries, saved: entries, baseline: new Uint8Array(), undo: [], redo: [], revision: 0, status: 'saved' })
describe('playlist history', () => {
  it('moves discontiguous selections in original order with destination correction', () => {
    expect(moveEntries(entries, new Set(['b', 'd']), 5).map(e => e.id)).toEqual(['a', 'c', 'e', 'b', 'd'])
  })
  it('maintains the exact occurrence set at every insertion', () => {
    for (let i = -1; i < 8; i++) {
      const moved = moveEntries(entries, new Set(['b', 'd']), i)
      expect(moved.map(e => e.id).sort()).toEqual(entries.map(e => e.id).sort())
      expect(moved.filter(e => ['b', 'd'].includes(e.id)).map(e => e.id)).toEqual(['b', 'd'])
    }
  })
  it('does not record no-ops; new edits clear redo', () => {
    const first = session()
    expect(edit(first, [...entries], 'none')).toBe(first)
    const changed = edit(first, entries.slice(1), 'remove')
    const undone = travel(changed, 'undo')
    expect(isDirty(undone)).toBe(false)
    expect(edit(undone, entries.slice(0, 2), 'remove').redo).toEqual([])
  })
  it('undo after saving makes the draft dirty without changing the baseline', () => {
    const changed = edit(session(), entries.slice(1), 'remove')
    const saved = { ...changed, saved: changed.entries, status: 'saved' as const }
    const undone = travel(saved, 'undo')
    expect(isDirty(undone)).toBe(true)
    expect(undone.baseline).toBe(saved.baseline)
  })
  it('bounds history and freezes operations during saving', () => {
    let current = session()
    for (let i = 0; i < 130; i++) current = edit(current, i % 2 ? entries : entries.slice(1), 'edit')
    expect(current.undo).toHaveLength(100)
    const busy = { ...current, status: 'saving' as const }
    expect(travel(busy, 'undo')).toBe(busy)
    const uncertain = { ...current, status: 'unverified' as const }
    expect(edit(uncertain, [], 'remove')).toBe(uncertain)
    expect(travel(uncertain, 'undo')).toBe(uncertain)
  })
})
