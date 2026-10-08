import { JOURNAL_PATH, syncKey, type RenameIntent } from '../../domain/orderSync'
import { AUDIO_EXTENSIONS, dirname, extension } from '../../domain/models'
import { normalizeRelative } from '../../playlists/paths'
import { equalBytes, hashBytes } from './saveProtocol'
import { createSHA256 } from 'hash-wasm'

export interface SyncMove extends RenameIntent { fingerprint: string }
export interface SyncPatch { path: string; before: number[] | null; after: number[] }
export interface SyncJournal {
  version: 1; token: string; libraryId: string; sessionId: string; revision: number; folder: string
  phase: 'staging' | 'finalizing' | 'writing' | 'complete'
  moves: SyncMove[]; patches: SyncPatch[]; order: string[]
}
export interface SyncDisk {
  readFresh(path: string): Promise<File | null>
  moveFile(source: string, target: string): Promise<void>
  writeSyncFile(path: string, bytes: Uint8Array, expected: Uint8Array | null): Promise<unknown>
}
export async function fingerprint(file: File) {
  // Native moves can change filesystem timestamps. Verify content instead of
  // treating a timestamp change caused by our own rename as an external edit.
  // Hash every byte in bounded chunks, including the middle of large recordings.
  const hash = await createSHA256()
  hash.init()
  for (let offset = 0; offset < file.size; offset += 1024 * 1024) hash.update(new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer()))
  return `sha256:${file.size}:${hash.digest('hex')}`
}
async function matchesFingerprint(file: File, expected: string, moved: boolean) {
  if (expected.startsWith('sha256:')) return await fingerprint(file) === expected
  // Resume journals written by the previous branch without deleting recovery
  // data. Keep its strict timestamp check on the original source; at a staged
  // or final path, verify its recorded size and content sample independently.
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer()), tail = new Uint8Array(await file.slice(Math.max(65536, file.size - 65536)).arrayBuffer())
  const sample = new Uint8Array(head.length + tail.length); sample.set(head); sample.set(tail, head.length)
  const [size, modified, hash] = expected.split(':')
  return String(file.size) === size && (moved || String(file.lastModified) === modified) && await hashBytes(sample) === hash
}
export function journalBytes(journal: SyncJournal) {
  const bytes = new TextEncoder().encode(JSON.stringify(journal))
  if (bytes.length > 64 * 1024 * 1024) throw new Error('Recovery data exceeds the safe journal limit. Reduce the number or size of affected playlists.')
  return bytes
}
export function parseJournal(bytes: Uint8Array): SyncJournal {
  if (bytes.length > 64 * 1024 * 1024) throw new Error('Recovery journal exceeds the inspection limit.')
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as SyncJournal
  const safe = (path: unknown): path is string => typeof path === 'string' && normalizeRelative(path) === path
  const data = (bytes: unknown): bytes is number[] => Array.isArray(bytes) && bytes.length <= 16 * 1024 * 1024 && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  if (value.version !== 1 || typeof value.token !== 'string' || !/^[\w-]+$/.test(value.token) || typeof value.libraryId !== 'string' || typeof value.sessionId !== 'string' || !Number.isInteger(value.revision) || !Array.isArray(value.order) || value.order.some(id => typeof id !== 'string') || !['staging', 'finalizing', 'writing', 'complete'].includes(value.phase) || (value.folder !== '' && !safe(value.folder)) || !Array.isArray(value.moves) || !Array.isArray(value.patches)) throw new Error('The recovery journal is invalid. No files were changed.')
  for (const move of value.moves) if (!safe(move.source) || !safe(move.target) || !safe(move.temporary) || [move.source, move.target, move.temporary].some(path => dirname(path) !== value.folder) || !move.temporary.split('/').at(-1)?.startsWith(`.meloark-${value.token}-`) || typeof move.fingerprint !== 'string' || !/^(?:sha256:\d+:|\d+:[\d.]+:)[a-f0-9]{64}$/.test(move.fingerprint) || ![...AUDIO_EXTENSIONS, 'lrc'].includes(extension(move.source)) || extension(move.source) !== extension(move.target) || extension(move.source) !== extension(move.temporary)) throw new Error('Unsafe rename data in the recovery journal.')
  for (const key of ['source', 'target', 'temporary'] as const) if (new Set(value.moves.map(move => syncKey(move[key]))).size !== value.moves.length) throw new Error('Duplicate rename paths in the recovery journal.')
  for (const patch of value.patches) if (!safe(patch.path) || !/\.m3u8?$/i.test(patch.path) || (patch.before !== null && !data(patch.before)) || !data(patch.after)) throw new Error('Unsafe playlist data in the recovery journal.')
  return value
}
export async function readJournal(disk: SyncDisk) {
  const file = await disk.readFresh(JOURNAL_PATH)
  if (!file) return null
  if (file.size > 64 * 1024 * 1024) throw new Error('Recovery journal exceeds the inspection limit.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { journal: parseJournal(bytes), bytes }
}
export async function prepareJournal(disk: SyncDisk, journal: Omit<SyncJournal, 'phase' | 'moves'> & { moves: RenameIntent[] }): Promise<SyncJournal> {
  if (await disk.readFresh(JOURNAL_PATH)) throw new Error('An unfinished filename sync needs recovery before another batch can start.')
  const moves: SyncMove[] = []
  const sourceKeys = new Set(journal.moves.map(move => syncKey(move.source)))
  for (const intent of journal.moves) {
    const file = await disk.readFresh(intent.source)
    if (!file || await disk.readFresh(intent.temporary)) throw new Error(`The inventory changed before sync: ${intent.source}`)
    if (!sourceKeys.has(syncKey(intent.target)) && await disk.readFresh(intent.target)) throw new Error(`A target is occupied: ${intent.target}`)
    moves.push({ ...intent, fingerprint: await fingerprint(file) })
  }
  const result: SyncJournal = { ...journal, phase: 'staging', moves }
  parseJournal(journalBytes(result))
  return result
}
export async function executeJournal(disk: SyncDisk, initial: SyncJournal, initialBytes: Uint8Array | null, saveCache: (journal: SyncJournal) => Promise<void>): Promise<SyncJournal> {
  let journal = initial, expected = initialBytes
  async function save(phase: SyncJournal['phase']) {
    journal = { ...journal, phase }; const bytes = journalBytes(journal)
    // Cache first: a storage failure must stop before any native move.
    await saveCache(journal); await disk.writeSyncFile(JOURNAL_PATH, bytes, expected); expected = bytes
  }
  if (expected === null) await save(journal.phase)
  async function relocate(from: string, to: string, move: SyncMove) {
    const source = await disk.readFresh(from), target = await disk.readFresh(to)
    if (!!source === !!target) throw new Error(`Recovery cannot choose safely between ${from} and ${to}. Review the files before retrying.`)
    const file = source ?? target!
    if (!await matchesFingerprint(file, move.fingerprint, !source || from !== move.source)) throw new Error(`A file changed outside Meloark: ${source ? from : to}. Sync stopped.`)
    if (source) await disk.moveFile(from, to)
    const verified = await disk.readFresh(to)
    if (!verified || await disk.readFresh(from) || !await matchesFingerprint(verified, move.fingerprint, true)) throw new Error(`Rename could not be verified: ${to}. Recovery data was preserved.`)
  }
  if (journal.phase === 'staging') {
    for (const move of journal.moves) await relocate(move.source, move.temporary, move)
    await save('finalizing')
  }
  if (journal.phase === 'finalizing') {
    for (const move of journal.moves) await relocate(move.temporary, move.target, move)
    await save('writing')
  }
  if (journal.phase === 'writing') {
    for (const patch of journal.patches) {
      const file = await disk.readFresh(patch.path), actual = file ? new Uint8Array(await file.arrayBuffer()) : null, after = new Uint8Array(patch.after)
      if (actual && equalBytes(actual, after)) continue
      await disk.writeSyncFile(patch.path, after, patch.before === null ? null : new Uint8Array(patch.before))
    }
    await save('complete')
  }
  for (const move of journal.moves) { const file = await disk.readFresh(move.target); if (!file || !await matchesFingerprint(file, move.fingerprint, true)) throw new Error(`Final file verification failed: ${move.target}`) }
  for (const patch of journal.patches) { const file = await disk.readFresh(patch.path); if (!file || !equalBytes(new Uint8Array(await file.arrayBuffer()), new Uint8Array(patch.after))) throw new Error(`Final playlist verification failed: ${patch.path}`) }
  return journal
}
