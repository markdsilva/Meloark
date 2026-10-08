import { openDB, type DBSchema } from 'idb'
import type { Library } from '../../app/store'
import type { DirectoryHandle } from '../filesystem/types'
import { storageOutcome, handleOutcome } from '../capabilities/status'
import type { LyricsRecord } from '../../lyrics/types'
import type { SyncJournal } from '../filesystem/orderSyncProtocol'

interface MeloarkDB extends DBSchema {
  libraries: { key: string; value: Library }
  handles: { key: string; value: DirectoryHandle }
  lyrics: { key: string; value: LyricsRecord; indexes: { libraryId: string } }
  syncJournals: { key: string; value: SyncJournal }
}
// Keep the legacy database name so existing libraries, handles, drafts and lyrics survive the rename.
const database = () => openDB<MeloarkDB>('trackindex-web', 3, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) { db.createObjectStore('libraries', { keyPath: 'id' }); db.createObjectStore('handles') }
    if (oldVersion < 2) db.createObjectStore('lyrics', { keyPath: 'trackId' }).createIndex('libraryId', 'libraryId')
    if (oldVersion < 3) db.createObjectStore('syncJournals')
  },
  blocked() { storageOutcome(new Error('Close other Meloark tabs to finish the browser storage upgrade.')) },
  blocking(_old, _next, event) { (event.target as IDBDatabase).close() },
}).catch(error => { storageOutcome(error); throw error })
export async function loadLibraries(): Promise<Library[]> {
  const db = await database()
  try { const libraries = await db.getAll('libraries'); storageOutcome(); return libraries }
  catch (error) { storageOutcome(error); throw error } finally { db.close() }
}
export async function saveLibraries(libraries: Library[]) {
  const db = await database()
  try {
    const transaction = db.transaction('libraries', 'readwrite')
    await transaction.store.clear()
    for (const library of libraries) {
      await transaction.store.put({ ...library, scanning: false, connected: false,
        sessions: Object.fromEntries(Object.entries(library.sessions).map(([id, session]) => [id, { ...session, undo: [], redo: [] }])) })
    }
    await transaction.done
    storageOutcome()
  } catch (error) { storageOutcome(error); throw error } finally { db.close() }
}
export async function saveHandle(id: string, handle: DirectoryHandle) {
  const db = await database()
  try { await db.put('handles', handle, id); handleOutcome() }
  catch (error) { handleOutcome(error); throw error } finally { db.close() }
}
export async function loadHandle(id: string) {
  const db = await database()
  try { const handle = await db.get('handles', id); if (handle) handleOutcome(); return handle }
  catch (error) { handleOutcome(error); throw error } finally { db.close() }
}
export async function deleteLibrary(id: string) {
  const db = await database()
  try {
    const tx = db.transaction(['libraries', 'handles', 'lyrics'], 'readwrite')
    await tx.objectStore('libraries').delete(id)
    await tx.objectStore('handles').delete(id)
    let cursor = await tx.objectStore('lyrics').index('libraryId').openCursor(id)
    while (cursor) { await cursor.delete(); cursor = await cursor.continue() }
    await tx.done
  } finally { db.close() }
}
export async function loadLyrics(trackId: string) {
  const db = await database()
  try { return await db.get('lyrics', trackId) } finally { db.close() }
}
export async function saveLyrics(record: LyricsRecord) {
  const db = await database()
  try { await db.put('lyrics', record) } finally { db.close() }
}
export async function saveSyncJournal(journal: SyncJournal) {
  const db = await database()
  try { await db.put('syncJournals', journal, journal.libraryId) } finally { db.close() }
}
export async function loadSyncJournal(libraryId: string) {
  const db = await database()
  try { return await db.get('syncJournals', libraryId) } finally { db.close() }
}
export async function clearSyncJournal(libraryId: string) {
  const db = await database()
  try { await db.delete('syncJournals', libraryId) } finally { db.close() }
}
