import { create } from 'zustand'
import { AUDIO_EXTENSIONS, extension, filename, naturalCompare, newId, type PlaylistEntry, type PlaylistSession, type Track } from '../domain/models'
import { filenameIndex } from '../domain/filenameIndex'
import { edit, moveEntries, travel } from '../domain/history'
import { emptyDocument, parsePlaylist, serializePlaylist, normalizedDocument, MAX_BYTES } from '../playlists/codec'
import { normalizeRelative, relativeReference } from '../playlists/paths'
import { playbackSupport } from '../platform/capabilities/detect'
import { usePlatformStatus } from '../platform/capabilities/status'
import type { LibrarySource } from '../platform/filesystem/types'
import { PortableSource } from '../platform/filesystem/portable'
import { equalBytes, hashBytes, UnverifiedWriteError } from '../platform/filesystem/saveProtocol'
import { loadLibraries, saveLibraries, loadHandle, saveHandle, deleteLibrary } from '../platform/persistence/database'
import { player, usePlayer } from '../playback/player'
import { scheduleMetadata } from '../metadata/scheduler'
import { validatePlaylistDeletion } from '../platform/filesystem/deleteProtocol'

export interface Library {
  id: string; name: string; kind: 'direct' | 'portable'; connected: boolean; scanning: boolean; generation: number
  tracks: Record<string, Track>; playlists: string[]; files: string[]; sessions: Record<string, PlaylistSession>; activePlaylist?: string
  scanError?: string
  hiddenPlaylists?: string[]
}
interface AppState {
  libraries: Library[]; activeLibrary?: string; view: 'library' | 'playlist' | 'albums'
  ready: boolean; notice?: string; storageError?: string; busy: boolean
  visibleTrackIds: string[]
}
export const useApp = create<AppState>(() => ({ libraries: [], view: 'library', ready: false, busy: false, visibleTrackIds: [] }))
export const sources = new Map<string, LibrarySource>()
const scanners = new Map<string, AbortController>()
let persistenceTimer: ReturnType<typeof setTimeout> | undefined
let persistenceChain = Promise.resolve()
let startup: Promise<void> | undefined
export const activeLibrary = () => useApp.getState().libraries.find(library => library.id === useApp.getState().activeLibrary)
export const activeSession = () => { const library = activeLibrary(); return library?.activePlaylist ? library.sessions[library.activePlaylist] : undefined }
export function notify(notice?: string) { useApp.setState({ notice }) }
function persistSoon() {
  clearTimeout(persistenceTimer)
  persistenceTimer = setTimeout(() => { void persistNow() }, 300)
}
export async function persistNow() {
  clearTimeout(persistenceTimer)
  const libraries = useApp.getState().libraries
  const task = persistenceChain.then(() => saveLibraries(libraries))
  persistenceChain = task.catch(() => undefined)
  try { await task }
  catch { useApp.setState({ storageError: 'Browser storage is unavailable or full. This session still works; save or export your playlist before closing.' }) }
}
function updateLibrary(id: string, update: (library: Library) => Library, persist = true) {
  useApp.setState(state => ({ libraries: state.libraries.map(library => library.id === id ? update(library) : library) }))
  syncPlayer()
  if (persist) persistSoon()
}
function syncPlayer() {
  const library = activeLibrary(), session = activeSession()
  const context = usePlayer.getState().context
  if (context?.kind === 'library' && context.libraryId === library?.id) {
    // Browsing filters are a snapshot, while fresh metadata and missing files reconcile.
    const entries = library.scanning ? player.queue.entries : player.queue.entries.filter(entry => entry.trackId && library.tracks[entry.trackId])
    player.configure(context, entries, library.tracks, library.connected ? sources.get(library.id) : undefined)
  } else {
    player.configure(library && session ? { kind: 'playlist', libraryId: library.id, sessionId: session.id } : undefined,
      session?.entries ?? [], library?.tracks ?? {}, library?.connected ? sources.get(library.id) : undefined)
  }
}
export function playLibraryTrack(id: string, orderedIds = useApp.getState().visibleTrackIds) {
  const library = activeLibrary(), source = library && sources.get(library.id)
  if (!library?.connected || !source || !library.tracks[id]) { notify('Reconnect the library to play this track.'); return }
  const ids = [...new Set(orderedIds.includes(id) ? orderedIds : [id, ...orderedIds])].filter(key => library.tracks[key])
  player.configure({ kind: 'library', libraryId: library.id }, ids.map(trackId => ({ id: trackId, trackId })), library.tracks, source)
  player.queue.start(id); void player.play(id)
}
export function playPlaylistEntry(id: string) {
  const library = activeLibrary(), session = activeSession(), source = library && sources.get(library.id)
  if (!library?.connected || !session || !source || !session.entries.some(entry => entry.id === id)) return
  player.configure({ kind: 'playlist', libraryId: library.id, sessionId: session.id }, session.entries, library.tracks, source)
  player.queue.start(id); void player.play(id)
}
export function togglePlayback() {
  if (usePlayer.getState().current) { void player.toggle(); return }
  if (useApp.getState().view === 'playlist') {
    const first = activeSession()?.entries[0]; if (first) playPlaylistEntry(first.id)
  } else {
    const first = useApp.getState().visibleTrackIds[0]; if (first) playLibraryTrack(first)
  }
}
export function selectLibrary(id: string) {
  useApp.setState({ activeLibrary: id, view: 'library', notice: undefined, visibleTrackIds: [] })
  syncPlayer()
}
export function selectView(view: AppState['view']) { useApp.setState({ view }) }
export function bootstrap() {
  startup ??= (async () => {
    try {
      const libraries = (await loadLibraries()).map(library => ({ ...library, connected: false, scanning: false,
        sessions: Object.fromEntries(Object.entries(library.sessions).map(([id, session]) => [id, { ...session, undo: [], redo: [],
          status: session.status === 'saving' ? 'unverified' as const : session.status }])) }))
      useApp.setState({ libraries, activeLibrary: libraries[0]?.id })
      for (const library of libraries.filter(l => l.kind === 'direct')) {
        const handle = await loadHandle(library.id)
        if (handle) {
          const { DirectSource } = await import('../platform/filesystem/direct')
          const source = new DirectSource(handle)
          sources.set(library.id, source)
          if ((await source.getAccess()).read === 'granted') void scanLibrary(library.id)
        }
      }
    } catch { useApp.setState({ storageError: 'Library remembering is unavailable. You can still select files and export playlists.' }) }
    finally { useApp.setState({ ready: true }) }
  })()
  return startup
}
export async function addSource(source: LibrarySource, reconnectId?: string) {
  // A quick selection must not be overwritten by asynchronous workspace restore.
  await bootstrap()
  const id = reconnectId ?? newId()
  const existing = useApp.getState().libraries.find(l => l.id === id)
  if (existing && existing.name !== source.name && !confirm(`Reconnect “${existing.name}” to “${source.name}”? Review missing tracks afterward.`)) return
  sources.set(id, source)
  if (!existing) useApp.setState(state => ({ libraries: [...state.libraries, { id, name: source.name, kind: source.kind, connected: true,
    scanning: false, generation: 0, tracks: {}, playlists: [], files: [], sessions: {} }], activeLibrary: id, view: 'library' }))
  else updateLibrary(id, library => ({ ...library, kind: source.kind, name: source.name, connected: true }))
  selectLibrary(id)
  await scanLibrary(id)
}
export async function openPortable(files: File[], reconnectId?: string) {
  try { await addSource(new PortableSource(files), reconnectId) } catch (error) { notify(message(error)) }
}
export async function openDirectory(reconnectId?: string) {
  try {
    const handle = await window.showDirectoryPicker!({ mode: 'read' })
    usePlatformStatus.setState({ pickerReason: undefined })
    const { DirectSource } = await import('../platform/filesystem/direct')
    let id = reconnectId ?? newId()
    if (!reconnectId) {
      for (const [knownId, source] of sources) {
        if (source instanceof DirectSource && await handle.isSameEntry(source.root)) { id = knownId; break }
      }
    }
    await addSource(new DirectSource(handle), id)
    try { await saveHandle(id, handle) } catch { useApp.setState({ storageError: 'The folder opened, but its handle could not be remembered. Reselect it next time.' }) }
  } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) { usePlatformStatus.setState({ pickerReason: message(error) }); notify(message(error)) } }
}
export async function reconnect(id: string) {
  const source = sources.get(id)
  try { if (source && await source.requestAccess('read')) await scanLibrary(id); else notify('Choose the library folder again to reconnect.') }
  catch (error) { notify(message(error)) }
}
export async function scanLibrary(id: string) {
  const source = sources.get(id), old = useApp.getState().libraries.find(l => l.id === id)
  if (!source || !old) return
  scanners.get(id)?.abort()
  const controller = new AbortController(); scanners.set(id, controller)
  const generation = old.generation + 1
  updateLibrary(id, library => ({ ...library, scanning: true, scanError: undefined, generation }), false)
  const tracks: Record<string, Track> = {}, files: string[] = [], playlists: string[] = []
  try {
    for await (const file of source.scan(controller.signal)) {
      files.push(file.path)
      const suffix = extension(file.path)
      if (AUDIO_EXTENSIONS.has(suffix)) {
        const trackId = `${id}:${file.path}`
        const cached = old.tracks[trackId]
        const parsed = filenameIndex(file.path)
        tracks[trackId] = cached && cached.size === file.size && cached.lastModified === file.lastModified ? cached : {
          id: trackId, path: file.path, filename: filename(file.path), size: file.size, lastModified: file.lastModified, index: parsed.index,
          metadataStatus: 'pending', metadata: { title: parsed.title, artist: '', album: '' }, support: playbackSupport(file.path) }
      } else if (suffix === 'm3u' || suffix === 'm3u8') playlists.push(file.path)
      if (files.length % 100 === 0) updateLibrary(id, library => ({ ...library, tracks: { ...old.tracks, ...tracks }, files: [...files], playlists: [...playlists] }), false)
    }
    controller.signal.throwIfAborted()
    const available = new Map(Object.values(tracks).map(track => [track.path, track.id]))
    const refreshEntries = (entries: PlaylistEntry[]) => entries.map(entry => {
      if (!entry.path) return entry
      return available.has(entry.path) ? { ...entry, trackId: available.get(entry.path), issue: undefined } : { ...entry, trackId: undefined, issue: 'Track was not found. Resolve it or remove this occurrence.' }
    })
    updateLibrary(id, library => ({ ...library, connected: true, scanning: false, tracks, files, playlists: playlists.sort(naturalCompare),
      sessions: Object.fromEntries(Object.entries(library.sessions).map(([key, session]) => [key, { ...session, entries: refreshEntries(session.entries), saved: refreshEntries(session.saved) }])) }))
    for (const session of Object.values(old.sessions)) await reconcileSource(id, session.id)
    const current = useApp.getState().libraries.find(l => l.id === id)
    const visible = playlists.filter(path => !current?.hiddenPlaylists?.includes(path))
    if (current && !current.activePlaylist && visible.length === 1) await loadPlaylist(visible[0], id)
    scheduleMetadata(id)
  } catch (error) {
    if (controller.signal.aborted) {
      if (scanners.get(id) === controller) updateLibrary(id, library => ({ ...library, scanning: false, scanError: 'Scan canceled. Refresh to complete the inventory.' }))
      return
    }
    updateLibrary(id, library => ({ ...library, scanning: false, connected: false, scanError: message(error) }))
  }
}
export function cancelScan(id: string) { scanners.get(id)?.abort() }
export async function loadPlaylist(path: string, libraryId = activeLibrary()?.id, encoding: 'utf-8' | 'windows-1252' = 'utf-8', reload = false) {
  const library = useApp.getState().libraries.find(l => l.id === libraryId), source = libraryId ? sources.get(libraryId) : undefined
  if (!library || useApp.getState().busy) return false
  const known = library.sessions[path] ?? Object.values(library.sessions).find(session => session.document.path === path)
  if (known && !reload) {
    updateLibrary(library.id, current => ({ ...current, activePlaylist: known.id })); selectView('playlist'); return true
  }
  if (!source) return false
  try {
    const file = await source.readFile(path)
    if (file.size > MAX_BYTES) throw new Error('Playlist exceeds the 16 MiB inspection limit. The original file is unchanged; rewriting is disabled.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const document = parsePlaylist(bytes, path, new Map(Object.values(library.tracks).map(track => [track.path, track.id])), encoding)
    const legacy = extension(path) === 'm3u'
    const session: PlaylistSession = { id: path, name: filename(path), document, entries: document.entries, saved: document.entries,
      baseline: legacy ? null : bytes, sourcePath: path, undo: [], redo: [], revision: 0, status: legacy ? 'new' : 'saved' }
    if (legacy) { session.document = { ...document, path: path.replace(/\.m3u$/i, '.m3u8'), encoding: 'utf-8', bom: false, newline: '\n' }; session.name = filename(session.document.path) }
    updateLibrary(library.id, current => ({ ...current, sessions: { ...current.sessions, [path]: session }, activePlaylist: path }))
    selectView('playlist')
    return true
  } catch (error) { notify(message(error)); throw error }
}
export function createPlaylist(name = 'My playlist.m3u8', paths?: string[]) {
  const library = activeLibrary()
  if (!library || library.scanning) return
  const path = name.toLowerCase().endsWith('.m3u8') ? name : `${name}.m3u8`
  if (normalizeRelative(path) !== path || path.includes('\\')) { notify('Use a valid library-relative M3U8 name.'); return }
  if (library.playlists.includes(path) || Object.values(library.sessions).some(session => session.document.path === path)) { notify('A playlist with that name already exists. Open it or choose another name.'); return }
  const document = emptyDocument(path)
  const tracks = new Map(Object.values(library.tracks).map(track => [track.path, track]))
  const entries = (paths ?? []).flatMap(trackPath => { const track = tracks.get(trackPath); return track ? [entryFor(track, path)] : [] })
  const session: PlaylistSession = { id: path, name: filename(path), document, entries, saved: [], baseline: null, undo: [], redo: [], revision: 0, status: 'new' }
  updateLibrary(library.id, current => ({ ...current, sessions: { ...current.sessions, [path]: session }, activePlaylist: path }))
  selectView('playlist')
}
function entryFor(track: Track, target: string): PlaylistEntry { return { id: newId(), raw: relativeReference(track.path, target), path: track.path, trackId: track.id, prelude: [] } }
export function updateSession(update: (session: PlaylistSession) => PlaylistSession) {
  const library = activeLibrary(), session = activeSession()
  if (!library || !session || useApp.getState().busy || session.status === 'unverified') return false
  updateLibrary(library.id, current => ({ ...current, sessions: { ...current.sessions, [session.id]: update(current.sessions[session.id]) } }))
  return true
}
export function addTracks(ids: string[], play = false) {
  const library = activeLibrary(), session = activeSession()
  if (!library || !session) { notify('Create or open a playlist before adding tracks.'); return }
  try {
    const entries = ids.flatMap(id => library.tracks[id] ? [entryFor(library.tracks[id], session.document.path)] : [])
    if (!entries.length || !updateSession(current => edit(current, [...current.entries, ...entries], `Add ${entries.length} tracks`))) return false
    if (play) playPlaylistEntry(entries[0].id)
    return true
  } catch (error) { notify(message(error)) }
}
export function removeEntries(ids: Set<string>) { updateSession(session => edit(session, session.entries.filter(entry => !ids.has(entry.id)), `Remove ${ids.size} from playlist`)) }
export function reorderEntries(ids: Set<string>, destination: number) { updateSession(session => edit(session, moveEntries(session.entries, ids, destination), `Move ${ids.size} tracks`)) }
export function history(direction: 'undo' | 'redo') { updateSession(session => travel(session, direction)) }
export function mapEntry(id: string, trackId: string) {
  const track = activeLibrary()?.tracks[trackId]
  if (!track) return
  updateSession(session => edit(session, session.entries.map(entry => entry.id === id ? { ...entry, trackId, path: track.path, raw: relativeReference(track.path, session.document.path), issue: undefined, suggestions: undefined } : entry), 'Resolve reference'))
}
export function createNormalizedCopy(name: string) {
  const library = activeLibrary(), session = activeSession()
  if (!library || !session) return
  try {
    const path = name.toLowerCase().endsWith('.m3u8') ? name : `${name}.m3u8`
    if (normalizeRelative(path) !== path || library.playlists.includes(path) || library.sessions[path]) throw new Error('Choose a valid, unused M3U8 name.')
    const document = normalizedDocument({ ...session.document, entries: session.entries }, path)
    const entries = document.entries.map(entry => ({ ...entry, id: newId() }))
    const copy: PlaylistSession = { ...session, id: path, name: filename(path), document, entries, saved: [], baseline: null, undo: [], redo: [], status: 'new', error: undefined }
    updateLibrary(library.id, current => ({ ...current, activePlaylist: path, sessions: { ...current.sessions, [path]: copy } }))
  } catch (error) { notify(message(error)) }
}
export async function reconcileSource(libraryId: string, sessionId: string) {
  const library = useApp.getState().libraries.find(l => l.id === libraryId), source = sources.get(libraryId), session = library?.sessions[sessionId]
  if (!library || !source || !session || (session.baseline === null && !session.expectedAttempt)) return
  try {
    const file = await source.readFile(session.document.path)
    if (file.size > MAX_BYTES) throw new Error('The source exceeds the playlist inspection limit. Export your preserved draft instead.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const attempted = session.expectedAttempt && await hashBytes(bytes) === session.expectedAttempt
    const same = equalBytes(bytes, session.baseline)
    if (!same && !attempted) {
      updateLibrary(libraryId, current => ({ ...current, sessions: { ...current.sessions, [sessionId]: { ...session, status: 'error', error: 'The source playlist changed. Your draft is preserved. Reload the source or export a copy.' } } }))
      return
    }
    const available = new Map(Object.values(library.tracks).map(track => [track.path, track.id]))
    const refreshed = (entries: PlaylistEntry[]) => entries.map(entry => entry.path && available.has(entry.path) ? { ...entry, trackId: available.get(entry.path), issue: undefined } : { ...entry, trackId: undefined, issue: 'Track was not found. Resolve it or remove this occurrence.' })
    const next = { ...session, entries: refreshed(session.entries), saved: refreshed(attempted ? session.entries : session.saved),
      baseline: attempted ? bytes : session.baseline, expectedAttempt: undefined, status: attempted ? 'saved' as const : 'dirty' as const, error: undefined }
    updateLibrary(libraryId, current => ({ ...current, sessions: { ...current.sessions, [sessionId]: next } }))
  } catch (error) { updateLibrary(libraryId, current => ({ ...current, sessions: { ...current.sessions, [sessionId]: { ...session, status: 'unverified', error: message(error) } } })) }
}
export async function savePlaylist() {
  const library = activeLibrary(), session = activeSession(), source = library ? sources.get(library.id) : undefined
  if (!library || !session || !source || useApp.getState().busy) return
  if (session.status === 'unverified') { notify('Reconcile the file before saving again.'); return }
  if (source.kind !== 'direct') { exportPlaylist(); return }
  useApp.setState({ busy: true })
  try {
    // Permission is requested in the Save click flow, before storage or file reads.
    if (!await source.requestAccess('write')) throw new Error('Write permission was not granted. Your draft is preserved; export remains available.')
    validateInventory(session, library)
    const bytes = serializePlaylist(session.document, session.entries)
    const attempt = await hashBytes(bytes)
    updateLibrary(library.id, current => ({ ...current, sessions: { ...current.sessions, [session.id]: { ...session, status: 'saving', expectedAttempt: attempt, error: undefined } } }), false)
    await persistNow()
    const write = () => source.writePlaylist(session.document.path, bytes, session.baseline)
    const receipt = navigator.locks ? await navigator.locks.request(`trackindex:${library.id}:${session.document.path}`, write) : await write()
    updateLibrary(library.id, current => ({ ...current, playlists: [...new Set([...current.playlists, session.document.path])].sort(naturalCompare),
      sessions: { ...current.sessions, [session.id]: { ...session, baseline: receipt.bytes, saved: session.entries, status: 'saved', expectedAttempt: undefined, error: undefined } } }), false)
    await persistNow()
    notify('Playlist saved and verified. Audio files were not changed.')
  } catch (error) {
    updateLibrary(library.id, current => ({ ...current, sessions: { ...current.sessions, [session.id]: { ...session,
      status: error instanceof UnverifiedWriteError ? 'unverified' : 'error', error: `${message(error)}${session.baseline === null ? ' If target creation started, an empty playlist file may remain.' : ''}`,
      expectedAttempt: error instanceof UnverifiedWriteError ? current.sessions[session.id].expectedAttempt : undefined } } }))
  } finally { useApp.setState({ busy: false }) }
}
export function exportPlaylist() {
  const session = activeSession(), library = activeLibrary()
  if (!session || !library) return
  try {
    validateInventory(session, library)
    const bytes = serializePlaylist(session.document, session.entries)
    const blob = new Blob([new Uint8Array(bytes).buffer], { type: 'audio/x-mpegurl;charset=utf-8' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = filename(session.document.path); document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    updateSession(current => ({ ...current, status: 'download' }))
    notify(`Download requested. Place ${filename(session.document.path)} at ${session.document.path} inside your library so relative paths work. The original file has not been updated.`)
  } catch (error) { notify(message(error)) }
}
function validateInventory(session: PlaylistSession, library: Library) {
  if (library.scanning || library.scanError) throw new Error('Complete a successful library scan before saving or exporting.')
  if (session.entries.some(entry => !entry.trackId || !library.tracks[entry.trackId] || library.tracks[entry.trackId].path !== entry.path)) throw new Error('A referenced track is missing from the library. Resolve it or remove it before saving or exporting.')
}
export async function forgetLibrary(id: string) {
  scanners.get(id)?.abort(); sources.delete(id)
  useApp.setState(state => ({ libraries: state.libraries.filter(library => library.id !== id), activeLibrary: state.activeLibrary === id ? state.libraries.find(l => l.id !== id)?.id : state.activeLibrary }))
  syncPlayer()
  try { await deleteLibrary(id) } catch { useApp.setState({ storageError: 'Could not remove the remembered library from browser storage.' }) }
  persistSoon()
}
export function playlistPaths(library: Library) {
  return [...new Set([...library.playlists, ...Object.values(library.sessions).map(session => session.document.path)])]
    .filter(path => !library.hiddenPlaylists?.includes(path)).sort(naturalCompare)
}
export function playlistSession(library: Library, path: string) {
  return Object.values(library.sessions).find(session => session.document.path === path)
}
export function removePlaylistFromApp(path: string, deleted = false, libraryId = activeLibrary()?.id) {
  const library = useApp.getState().libraries.find(item => item.id === libraryId)
  if (!library || useApp.getState().busy || library.scanning) return
  const affected = Object.values(library.sessions).filter(session => session.document.path === path)
  const activeRemoved = affected.some(session => session.id === library.activePlaylist)
  updateLibrary(library.id, current => ({ ...current,
    sessions: Object.fromEntries(Object.entries(current.sessions).filter(([, session]) => session.document.path !== path)),
    activePlaylist: activeRemoved ? undefined : current.activePlaylist,
    hiddenPlaylists: deleted ? (current.hiddenPlaylists ?? []).filter(item => item !== path) : current.playlists.includes(path) ? [...new Set([...(current.hiddenPlaylists ?? []), path])] : current.hiddenPlaylists,
    playlists: deleted ? current.playlists.filter(item => item !== path) : current.playlists,
    files: deleted ? current.files.filter(item => item !== path) : current.files,
  }))
  if (activeRemoved && activeLibrary()?.id === library.id) selectView('library')
}
export function restorePlaylist(path: string) {
  const library = activeLibrary()
  if (!library || useApp.getState().busy) return
  updateLibrary(library.id, current => ({ ...current, hiddenPlaylists: (current.hiddenPlaylists ?? []).filter(item => item !== path) }))
}
export async function inspectPlaylistDeletion(path: string) {
  validatePlaylistDeletion(path)
  const library = activeLibrary(), source = library && sources.get(library.id)
  if (!library?.connected || library.scanning || !source?.deletePlaylist || !library.playlists.includes(path)) throw new Error('Reconnect a direct-access library to delete its selected playlist file.')
  const file = await source.readFile(path)
  if (file.size > MAX_BYTES) throw new Error('This playlist exceeds the inspection limit. Use your file manager instead.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const session = playlistSession(library, path)
  if (session?.status === 'unverified') throw new Error('Reconcile this playlist before deleting its file.')
  if (session?.baseline && !equalBytes(bytes, session.baseline)) throw new Error('The playlist changed outside TrackIndex. Reload or review the source before deleting it.')
  return bytes
}
export async function deletePlaylistFile(path: string, expected: Uint8Array) {
  const library = activeLibrary(), source = library && sources.get(library.id)
  if (!library?.connected || !source?.deletePlaylist || useApp.getState().busy || library.scanning || !library.playlists.includes(path)) return false
  validatePlaylistDeletion(path)
  useApp.setState({ busy: true })
  try {
    if (!await source.requestAccess('write')) throw new Error('Write permission was not granted. The playlist has not been deleted.')
    const remove = () => source.deletePlaylist!(path, expected)
    const receipt = navigator.locks ? await navigator.locks.request(`trackindex:${library.id}:${path}`, remove) : await remove()
    if (receipt.path !== path || !receipt.deleted) throw new Error('Deletion was not verified. Reconcile the library.')
    // The source adapter verified absence. Cache failure cannot undo that filesystem outcome.
    useApp.setState({ busy: false })
    removePlaylistFromApp(path, true, library.id)
    await persistNow()
    notify(`Playlist file deleted and verified: ${path}. Music files were not changed.`)
    return true
  } finally { useApp.setState({ busy: false }) }
}
const metadataPatches = new Map<string, { generation: number; tracks: Map<string, Track['metadata']> }>()
let metadataTimer: ReturnType<typeof setTimeout> | undefined
export function applyMetadata(libraryId: string, generation: number, trackId: string, metadata: Track['metadata'], clearArtwork = false) {
  const library = useApp.getState().libraries.find(l => l.id === libraryId)
  if (!library || library.generation !== generation || !library.tracks[trackId]) return
  let patch = metadataPatches.get(libraryId)
  if (!patch || patch.generation !== generation) { patch = { generation, tracks: new Map() }; metadataPatches.set(libraryId, patch) }
  patch.tracks.set(trackId, { ...metadata, artwork: clearArtwork ? undefined : metadata.artwork ?? patch.tracks.get(trackId)?.artwork ?? library.tracks[trackId].metadata.artwork })
  metadataTimer ??= setTimeout(() => {
    metadataTimer = undefined
    for (const [id, batch] of metadataPatches) {
      updateLibrary(id, current => {
        if (current.generation !== batch.generation) return current
        const tracks = { ...current.tracks }
        for (const [trackId, metadata] of batch.tracks) {
          if (tracks[trackId]) tracks[trackId] = { ...tracks[trackId], metadata, metadataStatus: metadata.error ? 'error' : 'ready' }
        }
        return { ...current, tracks }
      })
    }
    metadataPatches.clear()
  }, 50)
}
export function message(error: unknown) { return error instanceof Error ? error.message : String(error) }
