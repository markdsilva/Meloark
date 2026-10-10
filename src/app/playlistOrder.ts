import { sources, useApp, findPlaylistSession, updateLibrary, type Library } from './store'
import { dirname, entrySignature, naturalCompare, type PlaylistDocument, type PlaylistEntry } from '../domain/models'
import { MAX_BYTES, parsePlaylist } from '../playlists/codec'
import { DirectSource } from '../platform/filesystem/direct'
import { equalBytes } from '../platform/filesystem/saveProtocol'
import { withFilesystemLock } from '../platform/filesystem/mutationLock'
import { filenameStem, planNames } from '../domain/orderSync'

export type PlaylistOrderChoice = 'saved' | 'draft' | 'filenames'
export interface PlaylistOrderReview {
  libraryId: string
  generation: number
  path: string
  bytes: Uint8Array
  document: PlaylistDocument
  sessionId?: string
  revision?: number
  draft?: PlaylistEntry[]
  signature?: string
}
export const filenameEntries = (library: Library, folder: string): PlaylistEntry[] => Object.values(library.tracks)
  .filter(track => dirname(track.path) === folder).sort((a, b) => naturalCompare(a.filename, b.filename))
  .map(track => ({ id: track.id, trackId: track.id, path: track.path, raw: track.filename, prelude: [] }))
export const sameTrackOrder = (a: PlaylistEntry[], b: PlaylistEntry[]) => JSON.stringify(a.map(entry => [entry.trackId, entry.path])) === JSON.stringify(b.map(entry => [entry.trackId, entry.path]))

// Inspection never changes the active playlist. Reuse saved occurrence IDs so
// playback/history keep their identities when a fresh disk order is adopted.
export async function inspectPlaylistOrder(path: string, libraryId: string): Promise<PlaylistOrderReview> {
  return withFilesystemLock(async () => {
    const library = useApp.getState().libraries.find(item => item.id === libraryId), source = sources.get(libraryId)
    if (!library?.connected || library.scanning || library.scanError || library.syncRecovery || !source) throw new Error('Reconnect and finish scanning or recovery before inspecting playlists.')
    const file = source instanceof DirectSource ? await source.readFresh(path) : await source.readFile(path)
    if (!file) throw new Error('The selected playlist was not found. Refresh the library.')
    if (file.size > MAX_BYTES) throw new Error('Playlist exceeds the 16 MiB inspection limit.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const document = parsePlaylist(bytes, path, new Map(Object.values(library.tracks).map(track => [track.path, track.id])))
    if (!document.inspected || document.issues.length) throw new Error(document.issues[0] ?? 'Playlist was not completely inspected.')
    const session = findPlaylistSession(library, path)
    const occurrences = new Map<string, PlaylistEntry[]>()
    for (const entry of session?.saved ?? []) {
      const key = JSON.stringify([entry.trackId, entry.path])
      occurrences.set(key, [...occurrences.get(key) ?? [], entry])
    }
    document.entries = document.entries.map(entry => ({ ...entry, id: occurrences.get(JSON.stringify([entry.trackId, entry.path]))?.shift()?.id ?? entry.id }))
    return { libraryId, generation: library.generation, path, bytes, document, sessionId: session?.id, revision: session?.revision,
      draft: session?.entries, signature: session ? entrySignature(session.entries) : undefined }
  })
}
export function reviewedEntries(review: PlaylistOrderReview, choice: PlaylistOrderChoice, library: Library, folder: string) {
  if (choice === 'draft') {
    if (!review.draft) throw new Error('There is no current draft to use. Inspect the playlist again.')
    // The choice concerns sequence. Keep freshly read per-track comments and
    // EXTINF metadata even when the current draft supplies the order.
    const fresh = new Map(review.document.entries.map(entry => [entry.id, entry]))
    return review.draft.map(entry => fresh.has(entry.id) ? { ...fresh.get(entry.id)!, id: entry.id } : entry)
  }
  if (choice === 'saved') return review.document.entries
  const byTrack = new Map(review.document.entries.map(entry => [entry.trackId, entry]))
  return filenameEntries(library, folder).map(entry => byTrack.get(entry.trackId) ?? entry)
}
export function folderOrderError(entries: PlaylistEntry[], library: Library, folder: string): string | undefined {
  try { planNames(entries, library.tracks, folder, Object.fromEntries(Object.values(library.tracks).map(track => [track.id, filenameStem(track.path)])), library.files, 'preview') }
  catch (reason) { return reason instanceof Error ? reason.message : String(reason) }
}
// Must run under the filesystem lock immediately before adopting a review.
export async function validatePlaylistOrder(review: PlaylistOrderReview) {
  const library = useApp.getState().libraries.find(item => item.id === review.libraryId), source = sources.get(review.libraryId)
  if (!library?.connected || library.scanning || library.scanError || library.syncRecovery || library.generation !== review.generation || !source) throw new Error('The library changed. Inspect the playlist again before applying this order.')
  const session = findPlaylistSession(library, review.path)
  if (session?.id !== review.sessionId || session?.revision !== review.revision || (session ? entrySignature(session.entries) : undefined) !== review.signature) throw new Error('The current draft changed. Inspect the playlist again before applying this order.')
  const file = source instanceof DirectSource ? await source.readFresh(review.path) : await source.readFile(review.path)
  if (!file || file.size > MAX_BYTES || !equalBytes(new Uint8Array(await file.arrayBuffer()), review.bytes)) throw new Error('The playlist changed since this preview. Inspect it again before applying this order.')
  return { library, session }
}
export async function adoptPlaylistOrder(review: PlaylistOrderReview, choice: 'saved' | 'draft') {
  await withFilesystemLock(async () => {
    const { library, session } = await validatePlaylistOrder(review)
    if (useApp.getState().busy || session?.sync || session?.status === 'unverified') throw new Error('Finish or disable the current sync/save before opening this playlist.')
    const entries = reviewedEntries(review, choice, library, '')
    const id = session?.id ?? review.path
    updateLibrary(library.id, current => ({ ...current, activePlaylist: id, sessions: { ...current.sessions, [id]: {
      ...(session ?? { id, name: review.path.split('/').at(-1)!, undo: [], redo: [], revision: 0 }),
      document: review.document, baseline: review.bytes, sourcePath: review.path, entries, saved: review.document.entries,
      status: sameTrackOrder(entries, review.document.entries) && entrySignature(entries) === entrySignature(review.document.entries) ? 'saved' : 'dirty', error: undefined,
    } } }))
    useApp.setState({ view: 'playlist' })
  })
}
