import { activeLibrary, activeSession, message, notify, persistNow, sources, updateLibrary, useApp } from './store'
import { AUDIO_EXTENSIONS, extension, dirname, filename, newId, naturalCompare, isDirty, type PlaylistEntry, type PlaylistSession } from '../domain/models'
import { filenameStem, inFolder, patchReferences, planNames, validFilename } from '../domain/orderSync'
import { emptyDocument, MAX_BYTES, serializePlaylist } from '../playlists/codec'
import { relativeReference } from '../playlists/paths'
import { DirectSource } from '../platform/filesystem/direct'
import { executeJournal, journalBytes, prepareJournal, readJournal, type SyncJournal } from '../platform/filesystem/orderSyncProtocol'
import { clearSyncJournal, loadSyncJournal, saveSyncJournal } from '../platform/persistence/database'
import { equalBytes } from '../platform/filesystem/saveProtocol'
import { player, usePlayer } from '../playback/player'

// One origin-wide lock also protects nested/overlapping registered libraries.
// External applications still need to leave the folder alone during a batch.
export const FILESYSTEM_LOCK = 'meloark:filesystem-mutation'
export const withFilesystemLock = <T>(run: () => Promise<T>): Promise<T> => navigator.locks ? navigator.locks.request(FILESYSTEM_LOCK, run) : run()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const running = new Set<string>()
let subscribed = false
export const syncBusy = (libraryId: string) => running.has(libraryId)
function setSync(libraryId: string, sessionId: string, status: NonNullable<PlaylistSession['sync']>['status'], error?: string) {
  updateLibrary(libraryId, library => {
    const session = library.sessions[sessionId]
    return !session?.sync ? library : { ...library, sessions: { ...library.sessions, [sessionId]: { ...session, sync: { ...session.sync, status, error } } } }
  })
}
function listen() {
  if (subscribed) return
  subscribed = true
  usePlayer.subscribe((state, old) => {
    if (old.current && (!state.current || state.context?.libraryId !== old.context?.libraryId)) {
      for (const library of useApp.getState().libraries) for (const session of Object.values(library.sessions)) if (session.sync?.enabled && session.sync.status === 'waiting') scheduleSync(library.id, session.id)
    }
  })
}
export function scheduleSync(libraryId: string, sessionId: string) {
  listen()
  const library = useApp.getState().libraries.find(item => item.id === libraryId), session = library?.sessions[sessionId]
  if (!session?.sync?.enabled || session.sync.status === 'error' || session.sync.status === 'recovery') return
  if (!isDirty(session)) return
  if (!running.has(libraryId) || session.sync.status !== 'syncing') setSync(libraryId, sessionId, 'queued')
  clearTimeout(timers.get(libraryId))
  timers.set(libraryId, setTimeout(() => { timers.delete(libraryId); void runSync(libraryId, sessionId) }, 350))
}
export function requestOrderSync() {
  const library = activeLibrary(), session = activeSession()
  if (!library || !session?.sync) return
  void (async () => {
    const source = sources.get(library.id)
    if (!source || !await source.requestAccess('write')) { setSync(library.id, session.id, 'error', 'Write access was not granted. Your order is preserved.'); return }
    if (library.syncRecovery || session.sync?.status === 'recovery') await recoverSync(library.id)
    else { setSync(library.id, session.id, 'queued'); await runSync(library.id, session.id) }
  })().catch(error => setSync(library.id, session.id, 'error', message(error)))
}
export function pauseOrderSync() {
  const library = activeLibrary(), session = activeSession()
  if (!library || !session?.sync || running.has(library.id) || library.syncRecovery) return
  const enabled = !session.sync.enabled
  updateLibrary(library.id, current => ({ ...current, sessions: { ...current.sessions, [session.id]: { ...session, sync: { ...session.sync!, enabled, status: enabled ? isDirty(session) ? 'queued' : 'synced' : 'paused' } } } }))
  if (enabled) scheduleSync(library.id, session.id)
  else clearTimeout(timers.get(library.id))
}
export function disableOrderSync() {
  const library = activeLibrary(), session = activeSession()
  if (!library || !session?.sync || running.has(library.id) || library.syncRecovery) return false
  clearTimeout(timers.get(library.id))
  updateLibrary(library.id, current => ({ ...current, sessions: { ...current.sessions, [session.id]: {
    ...session, sync: undefined,
    // A filename-only view becomes a real M3U8 draft only when the user disables
    // filename sync. Before this action it owns no playlist document or target.
    document: session.document ?? emptyDocument(`${session.name.replace(/\.m3u8$/i, '')}-${newId().slice(0, 8)}.m3u8`),
    status: session.document && !isDirty(session) ? 'saved' : 'dirty',
  } } }))
  notify('Automatic filename sync disabled. Current filenames were kept; future edits use the normal playlist workflow.')
  return true
}
export function stopPlaybackAndSync() { player.stop(); requestOrderSync() }

export async function checkRecovery(libraryId: string): Promise<boolean> {
  const source = sources.get(libraryId)
  if (!(source instanceof DirectSource)) return false
  try {
    const disk = await readJournal(source), cached = await loadSyncJournal(libraryId)
    if (!disk && !cached) return false
    const journal = disk?.journal ?? cached!
    updateLibrary(libraryId, library => ({ ...library, connected: true, scanning: false, syncRecovery: 'An interrupted filename sync was found. Recover it before scanning, saving, or renaming files.',
      sessions: Object.fromEntries(Object.entries(library.sessions).map(([id, session]) => [id, session.sync ? { ...session, sync: { ...session.sync, status: 'recovery' as const, error: 'Recovery is required before another sync.' } } : session])) }))
    if (journal.libraryId !== libraryId) notify('This folder contains recovery data from another remembered library. Reconnect the original library to recover it.')
    return true
  } catch (error) {
    updateLibrary(libraryId, library => ({ ...library, scanning: false, connected: true, syncRecovery: message(error) }))
    return true
  }
}

async function assertOwnership(libraryId: string, folder: string, sessionId?: string) {
  const source = sources.get(libraryId)
  if (!(source instanceof DirectSource) || !navigator.locks) throw new Error('Filename sync requires direct folder access and Web Locks. Use a current desktop Chromium browser.')
  for (const library of useApp.getState().libraries) {
    const other = sources.get(library.id)
    for (const session of Object.values(library.sessions)) {
      if (!session.sync || (library.id === libraryId && session.id === sessionId)) continue
      if (library.id === libraryId && session.sync.folder === folder) throw new Error('Another filename-sync playlist already owns this folder. Disable its sync first.')
      if (other instanceof DirectSource && library.id !== libraryId && (await source.root.isSameEntry(other.root) || await source.root.resolve(other.root) !== null || await other.root.resolve(source.root) !== null)) throw new Error('An overlapping remembered library already uses filename sync. Disable it or remove the overlapping registration first.')
    }
  }
}
export async function createSyncedPlaylist(name: string, folder: string, mode: 'filenames' | 'both', orderedTrackIds: string[], existingSessionId?: string) {
  const library = activeLibrary(), source = library && sources.get(library.id)
  if (!library?.connected || library.scanning || library.scanError || library.syncRecovery || useApp.getState().busy || !(source instanceof DirectSource)) throw new Error('Reconnect and complete the library scan before enabling filename sync.')
  // Request access first while still in the user's explicit Enable click.
  if (!await source.requestAccess('write')) throw new Error('Write permission was not granted.')
  await assertOwnership(library.id, folder, existingSessionId)
  const id = existingSessionId ?? `@filenames:${newId()}`, existing = existingSessionId ? library.sessions[existingSessionId] : undefined
  if (existingSessionId && !existing) throw new Error('The selected playlist could not be loaded. Open and resolve it before enabling sync.')
  if (existing && (existing.sync || !existing.document || existing.status === 'unverified' || !existing.document.inspected || existing.document.issues.length || existing.sourcePath?.endsWith('.m3u'))) throw new Error('Choose a fully resolved ordinary M3U8 playlist to use as the order authority.')
  if (!existing && !validFilename(`${name.trim().replace(/\.m3u8$/i, '')}.m3u8`)) throw new Error('Choose a valid Windows playlist name without a folder path.')
  const path = existing?.document?.path ?? inFolder(folder, `${name.trim().replace(/\.m3u8$/i, '')}.m3u8`)
  if (mode === 'both' && !existing && (library.files.some(file => file.toLowerCase() === path.toLowerCase()) || Object.values(library.sessions).some(item => item.document?.path.toLowerCase() === path.toLowerCase()))) throw new Error('That playlist name already exists. Choose another name or use it as the order authority.')
  const entries: PlaylistEntry[] = existing?.entries ?? orderedTrackIds.map(trackId => {
    const track = library.tracks[trackId]
    if (!track) throw new Error('A track disappeared. Refresh and review the order.')
    return { id: newId(), trackId, path: track.path, raw: mode === 'both' ? relativeReference(track.path, path) : track.filename, prelude: [] }
  })
  const stems = Object.fromEntries(entries.map(entry => [entry.trackId!, filenameStem(library.tracks[entry.trackId!]?.path ?? '')]))
  planNames(entries, library.tracks, folder, stems, library.files)
  await withFilesystemLock(async () => {
    if (await readJournal(source)) throw new Error('Recover the existing filename sync first.')
    await source.probeRename(folder)
  })
  const session: PlaylistSession = { ...(existing ?? { id, name: name.trim(), entries, saved: [], baseline: null, undo: [], redo: [], revision: 0, status: 'dirty' }),
    document: mode === 'both' ? existing?.document ?? emptyDocument(path) : undefined,
    sync: { mode, folder, stems, enabled: true, status: 'queued', committedRevision: -1 }, error: undefined }
  updateLibrary(library.id, current => ({ ...current, activePlaylist: session.id, sessions: { ...current.sessions, [session.id]: session } }))
  useApp.setState({ view: 'playlist' })
  await persistNow(true)
  scheduleSync(library.id, session.id)
}

async function makeJournal(libraryId: string, sessionId: string, source: DirectSource) {
  const library = useApp.getState().libraries.find(item => item.id === libraryId)!, session = library.sessions[sessionId], sync = session.sync!
  if (!library.connected || library.scanning || library.scanError || useApp.getState().busy) throw new Error('Wait for a complete scan and other file operations before syncing.')
  await assertOwnership(libraryId, sync.folder, sessionId)
  // Rescan the actual directory before every batch, not only remembered paths.
  const files: string[] = []
  for await (const file of source.scan(new AbortController().signal)) files.push(file.path)
  const knownAudio = new Set(Object.values(library.tracks).map(track => track.path))
  if (files.some(path => dirname(path) === sync.folder && AUDIO_EXTENSIONS.has(extension(path)) && !knownAudio.has(path)) || Object.values(library.tracks).some(track => dirname(track.path) === sync.folder && !files.includes(track.path))) throw new Error('Audio files were added, removed or renamed outside Meloark. Disable sync and refresh to review the new inventory.')
  const token = newId(), moves = planNames(session.entries, library.tracks, sync.folder, sync.stems, files, token), mapping = new Map(moves.map(move => [move.source, move.target]))
  const paths = new Set(Object.values(library.tracks).map(track => track.path)), patches: SyncJournal['patches'] = []
  for (const path of files.filter(path => /\.m3u8?$/i.test(path))) {
    const file = await source.readFresh(path)
    if (!file || file.size > MAX_BYTES) throw new Error(`Cannot inspect playlist ${path}.`)
    const before = new Uint8Array(await file.arrayBuffer())
    if (sync.mode === 'both' && session.document?.path === path) {
      if (!session.baseline || !equalBytes(session.baseline, before)) throw new Error('The order-authority playlist changed outside Meloark. Disable sync and reload it before enabling again.')
      continue
    }
    const after = patchReferences(before, path, paths, mapping)
    if (!equalBytes(before, after)) patches.push({ path, before: [...before], after: [...after] })
  }
  if (sync.mode === 'both' && session.document) {
    const entries = session.entries.map(entry => ({ ...entry, path: mapping.get(entry.path!) ?? entry.path }))
    const after = serializePlaylist(session.document, entries)
    if (!session.baseline || !equalBytes(session.baseline, after)) patches.push({ path: session.document.path, before: session.baseline ? [...session.baseline] : null, after: [...after] })
  }
  // Check all dependent playlists before staging a single audio file.
  for (const patch of patches) {
    const other = Object.values(library.sessions).find(item => item.document?.path === patch.path && item.id !== sessionId)
    if (other?.status === 'unverified' || (other?.baseline && !equalBytes(other.baseline, new Uint8Array(patch.before ?? [])))) throw new Error(`An open playlist needs reconciliation first: ${patch.path}`)
  }
  return prepareJournal(source, { version: 1, token, libraryId, sessionId, folder: sync.folder, revision: session.revision, moves, patches, order: session.entries.map(entry => entry.id) })
}

async function commitJournal(journal: SyncJournal, source: DirectSource) {
  const mapping = new Map(journal.moves.map(move => [move.source, move.target]))
  const mapEntries = (entries: PlaylistEntry[], target?: string) => entries.map(entry => {
    if (!entry.path || !mapping.has(entry.path)) return entry
    const path = entry.path ? mapping.get(entry.path) ?? entry.path : undefined
    return path ? { ...entry, path, raw: target ? relativeReference(path, target) : filename(path) } : entry
  })
  const stats = new Map<string, File>()
  for (const move of journal.moves.filter(item => item.trackId)) stats.set(move.trackId!, (await source.readFresh(move.target))!)
  updateLibrary(journal.libraryId, library => {
    // Cache commit can succeed before journal cleanup fails. A retry after
    // reload must not apply a swap mapping to the stable identities twice.
    if (library.syncAppliedToken === journal.token) return { ...library, syncRecovery: undefined,
      sessions: Object.fromEntries(Object.entries(library.sessions).map(([id, session]) => [id, id === journal.sessionId && session.sync ? { ...session, sync: { ...session.sync, status: isDirty(session) ? 'queued' as const : 'synced' as const, error: undefined } } : session])) }
    const tracks = Object.fromEntries(Object.entries(library.tracks).map(([id, track]) => {
      const path = mapping.get(track.path), file = stats.get(id)
      return [id, path ? { ...track, path, filename: filename(path), index: Number(filename(path).match(/^\d+/)?.[0]), size: file?.size ?? track.size, lastModified: file?.lastModified ?? track.lastModified } : track]
    }))
    const sessions = Object.fromEntries(Object.entries(library.sessions).map(([id, session]) => {
      const entries = mapEntries(session.entries, session.document?.path), saved = mapEntries(session.saved, session.document?.path)
      const patch = journal.patches.find(item => item.path === session.document?.path)
      const next = { ...session, entries, saved, baseline: patch ? new Uint8Array(patch.after) : session.baseline,
        document: session.document ? { ...session.document, entries: mapEntries(session.document.entries, session.document.path) } : undefined,
        undo: session.undo.map(command => ({ ...command, before: mapEntries(command.before, session.document?.path), after: mapEntries(command.after, session.document?.path) })),
        redo: session.redo.map(command => ({ ...command, before: mapEntries(command.before, session.document?.path), after: mapEntries(command.after, session.document?.path) })) }
      if (id === journal.sessionId && next.sync) {
        const byId = new Map(entries.map(entry => [entry.id, entry]))
        next.saved = journal.order.map(key => byId.get(key)!).filter(Boolean)
        next.sync = { ...next.sync, committedRevision: journal.revision, status: next.revision === journal.revision ? 'synced' : 'queued', error: undefined }
        next.status = next.revision === journal.revision ? 'saved' : 'dirty'
      }
      return [id, next]
    }))
    return { ...library, tracks, sessions, syncAppliedToken: journal.token, syncRecovery: undefined, files: [...new Set([...library.files.map(path => mapping.get(path) ?? path), ...journal.patches.map(patch => patch.path)])], playlists: [...new Set([...library.playlists, ...journal.patches.map(patch => patch.path)])].sort(naturalCompare) }
  })
  source.resetHandles()
  await persistNow(true)
  await source.removeJournal(journalBytes(journal))
  await clearSyncJournal(journal.libraryId)
}
async function runSync(libraryId: string, sessionId: string) {
  if (running.has(libraryId)) return
  const library = useApp.getState().libraries.find(item => item.id === libraryId), session = library?.sessions[sessionId], source = sources.get(libraryId)
  if (!session?.sync?.enabled || !isDirty(session) || !(source instanceof DirectSource) || library?.syncRecovery) return
  const playback = usePlayer.getState()
  if (playback.current && playback.context?.libraryId === libraryId) { setSync(libraryId, sessionId, 'waiting', 'Waiting until playback stops. Native file snapshots can become unreadable after a rename.'); return }
  running.add(libraryId); setSync(libraryId, sessionId, 'syncing')
  try {
    await withFilesystemLock(async () => {
      const playback = usePlayer.getState()
      if (playback.current && playback.context?.libraryId === libraryId) { setSync(libraryId, sessionId, 'waiting', 'Waiting until playback stops.'); return }
      if ((await source.getAccess()).write !== 'granted') throw new Error('Write access expired. Click Retry sync to reconnect it.')
      const journal = await makeJournal(libraryId, sessionId, source)
      if (!journal.moves.length && !journal.patches.length) { await commitJournal({ ...journal, phase: 'complete' }, source); return }
      const done = await executeJournal(source, journal, null, saveSyncJournal)
      await commitJournal(done, source)
    })
  } catch (error) {
    const recovery = await checkRecovery(libraryId)
    setSync(libraryId, sessionId, recovery ? 'recovery' : 'error', message(error))
  } finally {
    running.delete(libraryId)
    const next = useApp.getState().libraries.find(item => item.id === libraryId)?.sessions[sessionId]
    if (next?.sync?.enabled && next.sync.status === 'queued') scheduleSync(libraryId, sessionId)
  }
}
export async function recoverSync(libraryId = activeLibrary()?.id) {
  if (!libraryId || running.has(libraryId)) return
  const source = sources.get(libraryId), library = useApp.getState().libraries.find(item => item.id === libraryId)
  if (!(source instanceof DirectSource) || !library) return
  if (!await source.requestAccess('write')) { notify('Write access is needed to recover filename sync.'); return }
  if (usePlayer.getState().current && usePlayer.getState().context?.libraryId === libraryId) { notify('Stop playback before recovering file renames.'); return }
  running.add(libraryId)
  try {
    await withFilesystemLock(async () => {
      const disk = await readJournal(source), cached = await loadSyncJournal(libraryId), journal = disk?.journal ?? cached
      if (!journal || journal.libraryId !== libraryId || !library.sessions[journal.sessionId]?.sync) throw new Error('Reconnect the original remembered library and sync playlist. Recovery cannot invent track identities or an order authority.')
      const done = await executeJournal(source, journal, disk?.bytes ?? null, saveSyncJournal)
      await commitJournal(done, source)
      notify('Filename sync recovered and verified.')
    })
  } catch (error) { updateLibrary(libraryId, current => ({ ...current, syncRecovery: message(error) })); notify(message(error)) }
  finally {
    running.delete(libraryId)
    const current = useApp.getState().libraries.find(item => item.id === libraryId)
    for (const session of Object.values(current?.sessions ?? {})) if (session.sync?.enabled && session.sync.status === 'queued') scheduleSync(libraryId, session.id)
  }
}
