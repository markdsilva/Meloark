import { openDB, type DBSchema } from 'idb'
import type { Library } from '../../app/store'
import type { DirectoryHandle } from '../filesystem/types'

interface TrackIndexDB extends DBSchema {
  libraries: { key: string; value: Library }
  handles: { key: string; value: DirectoryHandle }
}
const database = () => openDB<TrackIndexDB>('trackindex-web', 1, {
  upgrade(db) { db.createObjectStore('libraries', { keyPath: 'id' }); db.createObjectStore('handles') },
})
export async function loadLibraries(): Promise<Library[]> {
  const db = await database()
  try { return await db.getAll('libraries') } finally { db.close() }
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
  } finally { db.close() }
}
export async function saveHandle(id: string, handle: DirectoryHandle) {
  const db = await database()
  try { await db.put('handles', handle, id) } finally { db.close() }
}
export async function loadHandle(id: string) {
  const db = await database()
  try { return await db.get('handles', id) } finally { db.close() }
}
export async function deleteLibrary(id: string) {
  const db = await database()
  try {
    const tx = db.transaction(['libraries', 'handles'], 'readwrite')
    await tx.objectStore('libraries').delete(id)
    await tx.objectStore('handles').delete(id)
    await tx.done
  } finally { db.close() }
}
