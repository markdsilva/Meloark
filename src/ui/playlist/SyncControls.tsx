import { useState } from 'react'
import { disableOrderSync, pauseOrderSync, requestOrderSync, stopPlaybackAndSync, syncBusy } from '../../app/orderSync'
import { useApp } from '../../app/store'
import { Dialog } from '../shared/Dialog'
import { SyncOrderReview } from './SyncOrderReview'

export function SyncControls({ removeNumbers }: { removeNumbers: (folder: string) => void }) {
  const library = useApp(s => s.libraries.find(item => item.id === s.activeLibrary))
  const session = library?.activePlaylist ? library.sessions[library.activePlaylist] : undefined
  const [settings, setSettings] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  if (!library || !session?.sync) return null
  const sync = session.sync, busy = syncBusy(library.id)
  const status = { queued: 'Sync pending', syncing: 'Syncing…', synced: 'Synced', paused: 'Sync paused', waiting: 'Waiting for playback to stop', error: 'Needs attention', recovery: 'Recovery required' }[sync.status]
  return <>
    <span className={`save-status ${sync.status === 'synced' ? '' : 'unsaved'}`} role="status"><i />{status}</span>
    {sync.mode === 'both' && session.document && <span className="sync-authority" title={`Numbered filenames and ${session.document.path} share this playlist’s order. Other playlists keep their own sequence.`}>With {session.document.path}</span>}
    {sync.status === 'waiting' && <button className="button secondary" onClick={stopPlaybackAndSync}>Stop & sync</button>}
    {['error', 'recovery'].includes(sync.status) && <button className="button secondary" disabled={busy} onClick={requestOrderSync}>{sync.status === 'recovery' ? 'Recover sync' : 'Retry sync'}</button>}
    {sync.status === 'error' && sync.mode === 'both' && !library.syncRecovery && <button className="button secondary" disabled={busy} onClick={() => setReviewing(true)}>Review playlist order</button>}
    <button className="button secondary" onClick={() => setSettings(true)}>Sync settings</button>
    {settings && <Dialog title="Filename sync settings" close={() => setSettings(false)}>
      <p><strong>{sync.mode === 'both' ? 'Numbered filenames + M3U8' : 'Numbered filenames only'}</strong><br />Folder: {sync.folder || 'Library root'}{sync.mode === 'both' && <><br />Synchronized playlist: {session.document?.path}</>}</p>
      <p>Other playlists keep their order. Their file references follow renames.</p>
      <p>Disable sync to add or remove tracks from this playlist. Audio files are never deleted.</p>
      {sync.error && <p className="callout" role="alert">{sync.error}</p>}
      <p className="muted">Disabling keeps current filenames. Filename-only playlists become M3U8 drafts; Save or Export to keep the order.</p>
      <p>Remove filename numbers without changing playlist order.</p>
      <button className="button secondary" disabled={busy || !!library.syncRecovery} onClick={() => { setSettings(false); removeNumbers(sync.folder) }}>Remove filename numbers…</button>
      <div className="dialog-actions"><button className="button secondary" disabled={busy || !!library.syncRecovery} onClick={pauseOrderSync}>{sync.enabled ? 'Pause sync' : 'Resume sync'}</button><button className="button secondary" disabled={busy || !!library.syncRecovery} onClick={() => { if (disableOrderSync()) setSettings(false) }}>Disable filename sync</button></div>
    </Dialog>}
    {reviewing && <SyncOrderReview close={() => setReviewing(false)} />}
  </>
}
