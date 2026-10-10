import { useEffect, useState } from 'react'
import { FileMusic, Plus, Settings2 } from 'lucide-react'
import { exportPlaylist, inspectPlaylistDeletion, deletePlaylistFile, playlistPaths, playlistSession, removePlaylistFromApp, restorePlaylist, savePlaylist, sources, useApp, type Library } from '../../app/store'
import { isDirty } from '../../domain/models'
import { ContextActions, type MenuAction } from '../shared/Menu'
import { Dialog } from '../shared/Dialog'
import { UnverifiedDeleteError } from '../../platform/filesystem/deleteProtocol'

export function PlaylistNavigation({ library, open, create }: { library: Library; open: (path: string) => Promise<boolean>; create: () => void }) {
  const busy = useApp(s => s.busy), view = useApp(s => s.view)
  const [manage, setManage] = useState(false)
  const [operation, setOperation] = useState<{ path: string; action: 'remove' | 'delete' }>()
  const [expected, setExpected] = useState<Uint8Array>()
  const [error, setError] = useState<string>(), [loading, setLoading] = useState(false), [uncertain, setUncertain] = useState(false)
  const source = sources.get(library.id)
  const paths = playlistPaths(library)
  useEffect(() => {
    setExpected(undefined); setError(undefined); setUncertain(false)
    if (operation?.action !== 'delete') { setLoading(false); return }
    let current = true
    setLoading(true)
    void inspectPlaylistDeletion(operation.path).then(bytes => { if (current) setExpected(bytes) }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [operation])
  async function act() {
    if (!operation || busy || loading) return
    if (operation.action === 'remove') { removePlaylistFromApp(operation.path); setOperation(undefined); return }
    if (!expected) return
    try { if (await deletePlaylistFile(operation.path, expected)) setOperation(undefined) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setUncertain(reason instanceof UnverifiedDeleteError) }
  }
  async function reconcile() {
    if (!operation || busy) return
    setLoading(true)
    try {
      await source!.readFile(operation.path)
      setError('The file still exists. Close this dialog and review or reload it before retrying.'); setUncertain(false)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'NotFoundError') { removePlaylistFromApp(operation.path, true); setOperation(undefined) }
      else setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setLoading(false) }
  }
  return <>
    <div className="nav-heading"><span>PLAYLISTS</span><div className="nav-heading-actions">
      <button className="icon-button" aria-label="Manage playlists" data-tooltip="Manage playlists" disabled={busy} onClick={() => setManage(true)}><Settings2 size={16} /></button>
      <button className="icon-button" aria-label="Create playlist" data-tooltip="Create playlist" disabled={library.scanning || busy} onClick={create}><Plus size={16} /></button>
    </div></div>
    {paths.map(path => {
      const session = playlistSession(library, path), active = view === 'playlist' && library.activePlaylist === session?.id
      const onDisk = library.playlists.includes(path)
      const canDelete = library.connected && onDisk && !session?.sync && !library.syncRecovery && !!source?.deletePlaylist && source.canDeletePlaylists !== false
      const items: MenuAction[] = [
        { label: 'Open', run: () => { void open(path) }, disabled: !library.connected && !session },
        ...(!session?.sync ? [{ label: 'Save playlist', run: () => { void open(path).then(success => { if (success) void savePlaylist() }) }, disabled: !session || library.kind !== 'direct' || !library.connected || busy || !!library.syncRecovery || session.status === 'unverified' }] : []),
        { label: 'Export', run: () => { void open(path).then(success => { if (success) exportPlaylist() }) }, disabled: !session || busy },
        { label: onDisk ? 'Remove from app' : 'Discard draft', run: () => { if (session && (isDirty(session) || session.undo.length || session.redo.length)) setOperation({ path, action: 'remove' }); else removePlaylistFromApp(path) }, disabled: busy || library.scanning || !!session?.sync || !!library.syncRecovery, reason: 'Disable filename sync before removing this playlist' },
        { label: 'Delete playlist file', run: () => setOperation({ path, action: 'delete' }), disabled: !canDelete || busy || library.scanning, reason: !onDisk ? 'This draft has no file to delete' : library.kind === 'portable' ? 'Use your file manager in portable mode' : !library.connected ? 'Reconnect the library first' : 'Direct file deletion is unavailable', danger: true },
      ]
      const label = session?.sync?.mode === 'filenames' ? session.name : path
      return <ContextActions key={path} label={`Actions for playlist ${label}`} items={items} className="playlist-row" disabled={busy}>
        <button className={`nav-item ${active ? 'active' : ''}`} aria-label={session?.name ?? path.split('/').at(-1)} data-tooltip={session?.sync?.mode === 'filenames' ? `${session.sync.folder || 'Library root'} · numbered filenames only` : session?.sourcePath && session.sourcePath !== path ? `${path} · imported from ${session.sourcePath}` : path} aria-current={active ? 'page' : undefined} onClick={() => { void open(path) }} disabled={busy || !library.connected && !session}><FileMusic size={16} /><span className="library-name">{session?.name ?? path.split('/').at(-1)}</span>{session && isDirty(session) && <span className="draft-dot" title={session.sync ? 'Sync pending' : 'Unsaved draft'} />}</button>
      </ContextActions>
    })}
    {!paths.length && <p className="nav-empty">No playlists yet.</p>}
    {manage && <Dialog title="Manage playlists" close={() => setManage(false)}><p className="dialog-intro">Removing a playlist from the app leaves its file in your library. Restore hidden playlists here.</p>
      {!(library.hiddenPlaylists?.length) && <p className="muted">No hidden playlists.</p>}
      {library.hiddenPlaylists?.map(path => <div className="manage-playlist-row" key={path}><span>{path}{!library.playlists.includes(path) && <small>Not found in the current inventory</small>}</span><button className="button secondary" disabled={busy} onClick={() => restorePlaylist(path)}>Restore</button></div>)}
    </Dialog>}
    {operation && <Dialog title={operation.action === 'delete' ? 'Delete playlist file?' : 'Discard playlist draft?'} close={() => { if (!busy) setOperation(undefined) }}>
      <p className="dialog-intro"><strong className="playlist-path">{operation.path}</strong></p>
      <p>{operation.action === 'delete' ? 'This permanently deletes this playlist file. It cannot be undone here. Music files are not deleted.' : 'This removes the playlist and its draft/history from the app. The playlist file, if any, stays in your folder.'}</p>
      {playlistSession(library, operation.path)?.sourcePath && playlistSession(library, operation.path)?.sourcePath !== operation.path && <p className="muted">Imported source: {playlistSession(library, operation.path)?.sourcePath}. This action targets only the filename above.</p>}
      {loading && <p role="status">Checking the playlist…</p>}{error && <p className="callout" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setOperation(undefined)}>Cancel</button>{uncertain ? <button className="button secondary" disabled={busy || loading} onClick={() => { void reconcile() }}>Reconcile deletion</button> : <button className={`button ${operation.action === 'delete' ? 'danger-button' : 'primary'}`} disabled={busy || loading || operation.action === 'delete' && (!expected || !!error)} onClick={() => { void act() }}>{busy ? 'Deleting…' : operation.action === 'delete' ? 'Delete playlist file' : 'Discard draft'}</button>}</div>
    </Dialog>}
  </>
}
