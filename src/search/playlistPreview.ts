import { playlistPaths, playlistSession, sources, useApp } from '../app/store'
import { MAX_BYTES } from '../playlists/codec'
import { syncBusy, withFilesystemLock } from '../app/orderSync'
import { SearchClient } from './client'
import type { SearchPlaylistPreview } from './types'

type Inspect = (bytes: Uint8Array<ArrayBuffer>, path: string, tracks: [string, string][]) => Promise<SearchPlaylistPreview>
const inspectInWorker: Inspect = async (bytes, path, tracks) => {
  const client = new SearchClient()
  try { return await client.preview(bytes, path, tracks) }
  finally { client.dispose() }
}

/** Inspect a playlist without loading a session, selecting a library, or writing a draft. */
export async function previewSearchPlaylist(libraryId: string, path: string, inspect: Inspect = inspectInWorker): Promise<SearchPlaylistPreview> {
  const library = useApp.getState().libraries.find(item => item.id === libraryId)
  if (!library || !playlistPaths(library).includes(path)) throw new Error('This playlist is no longer available.')
  const session = playlistSession(library, path)
  if (session) return { trackIds: session.entries.flatMap(entry => entry.trackId && !entry.issue && library.tracks[entry.trackId] ? [entry.trackId] : []), missing: session.entries.filter(entry => !entry.trackId || !!entry.issue || !library.tracks[entry.trackId]).length }
  const source = sources.get(libraryId)
  if (!library.connected || !source) throw new Error('Reconnect this library to explore its playlist.')
  if (library.syncRecovery || syncBusy(libraryId) || library.scanning) throw new Error('Wait for this library to finish scanning or syncing before exploring its playlist.')
  const snapshot = await withFilesystemLock(async () => {
    const current = useApp.getState().libraries.find(item => item.id === libraryId)
    if (!current?.connected || current.scanning || current.syncRecovery || syncBusy(libraryId)) throw new Error('Reconnect this library and finish scanning or syncing before exploring its playlist.')
    const file = await source.readFile(path)
    if (file.size > MAX_BYTES) throw new Error('This playlist is too large to preview.')
    return { bytes: new Uint8Array(await file.arrayBuffer()), tracks: Object.values(current.tracks).map(track => [track.path, track.id] as [string, string]) }
  })
  return inspect(snapshot.bytes, path, snapshot.tracks)
}
