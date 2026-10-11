import { expect, it } from 'vitest'
import { openDB } from 'idb'
import { loadHandle, loadLibraries, loadLyrics, loadSyncJournal } from '../../src/platform/persistence/database'

it('upgrades a v2 workspace additively without losing drafts, handles or lyrics', async () => {
  const old = await openDB('trackindex-web', 2, { upgrade(db) {
    db.createObjectStore('libraries', { keyPath: 'id' })
    db.createObjectStore('handles')
    db.createObjectStore('lyrics', { keyPath: 'trackId' }).createIndex('libraryId', 'libraryId')
  } })
  const library = { id: 'remembered', sessions: { draft: { entries: [{ id: 'occurrence', trackId: 'stable-track', path: 'Song.mp3' }], baseline: new Uint8Array([35, 10]) } } }
  const handle = { name: 'Music', kind: 'directory' }, lyrics = { trackId: 'stable-track', libraryId: 'remembered', text: '[00:00]Kept lyric' }
  await old.put('libraries', library)
  await old.put('handles', handle, 'remembered')
  await old.put('lyrics', lyrics)
  old.close()
  const restored = (await loadLibraries())[0]
  expect(restored.id).toBe(library.id)
  expect(restored.sessions.draft.entries).toEqual(library.sessions.draft.entries)
  expect([...restored.sessions.draft.baseline!]).toEqual([35, 10])
  expect(await loadHandle('remembered')).toEqual(handle)
  expect(await loadLyrics('stable-track')).toEqual(lyrics)
  expect(await loadSyncJournal('remembered')).toBeUndefined()
  const upgraded = await openDB('trackindex-web', 3)
  expect([...upgraded.objectStoreNames]).toEqual(['handles', 'libraries', 'lyrics', 'syncJournals'])
  upgraded.close()
})
