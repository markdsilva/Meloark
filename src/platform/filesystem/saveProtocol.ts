import { normalizeRelative } from '../../playlists/paths'
import type { WriteReceipt } from './types'

export class ConflictError extends Error {}
export class UnverifiedWriteError extends Error {}
export interface SaveTarget {
  read(): Promise<Uint8Array | null>
  open(): Promise<{ write(bytes: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}
export function equalBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  return a === null || b === null ? a === b : a.length === b.length && a.every((byte, i) => byte === b[i])
}
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  const hash = await crypto.subtle.digest('SHA-256', copy.buffer)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function verifiedWrite(path: string, bytes: Uint8Array, expected: Uint8Array | null, target: SaveTarget): Promise<WriteReceipt> {
  if (normalizeRelative(path) !== path || !path.toLowerCase().endsWith('.m3u8')) throw new Error('Only library-relative M3U8 targets may be written.')
  if (!equalBytes(await target.read(), expected)) throw new ConflictError('The playlist changed outside Meloark. Reload it or export a copy; the file was not overwritten.')
  const stream = await target.open()
  let closeStarted = false
  try {
    await stream.write(bytes)
    closeStarted = true
    await stream.close()
  } catch (error) {
    await stream.abort().catch(() => undefined)
    if (closeStarted) throw new UnverifiedWriteError(`Save could not be verified after closing. Reconcile the file before retrying. ${error instanceof Error ? error.message : ''}`)
    throw error
  }
  try {
    const readback = await target.read()
    if (!equalBytes(readback, bytes)) throw new Error('Read-back does not match the intended playlist.')
    return { bytes, hash: await hashBytes(bytes) }
  } catch (error) {
    throw new UnverifiedWriteError(`The file may have been written, but verification failed. ${error instanceof Error ? error.message : ''}`)
  }
}
