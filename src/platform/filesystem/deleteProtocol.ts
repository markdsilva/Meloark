import { normalizeRelative } from '../../playlists/paths'
import { MAX_BYTES } from '../../playlists/codec'
import { ConflictError, equalBytes } from './saveProtocol'
import type { DeleteReceipt } from './types'

export class UnverifiedDeleteError extends Error {}
export interface DeleteTarget { read(): Promise<Uint8Array | null>; remove(): Promise<void> }
export function validatePlaylistDeletion(path: string) {
  if (normalizeRelative(path) !== path || !/\.m3u8?$/i.test(path)) throw new Error('Only library-relative M3U/M3U8 files can be deleted.')
}
export async function verifiedDelete(path: string, expected: Uint8Array, target: DeleteTarget): Promise<DeleteReceipt> {
  validatePlaylistDeletion(path)
  if (expected.length > MAX_BYTES) throw new Error('This playlist exceeds the inspection limit. Use your file manager instead.')
  const current = await target.read()
  if (current === null) throw new ConflictError('The playlist is already missing. Reconcile the library before removing it from the app.')
  if (!equalBytes(current, expected)) throw new ConflictError('The playlist changed outside Meloark. Review it again; it was not deleted.')
  try {
    await target.remove()
    if (await target.read() !== null) throw new Error('The playlist still exists.')
  } catch (error) {
    throw new UnverifiedDeleteError(`Deletion could not be verified. Check the file before retrying. ${error instanceof Error ? error.message : ''}`)
  }
  return { path, deleted: true }
}
