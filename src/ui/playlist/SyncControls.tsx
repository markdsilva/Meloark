import { useState } from 'react'
import { disableOrderSync, pauseOrderSync, requestOrderSync, stopPlaybackAndSync, syncBusy } from '../../app/orderSync'
import { useApp } from '../../app/store'
import { Dialog } from '../shared/Dialog'

export function SyncControls({ removeNumbers }: { removeNumbers: (folder: string) => void }) {
  const library = useApp(s => s.libraries.find(item => item.id === s.activeLibrary))
  const session = library?.activePlaylist ? library.sessions[library.activePlaylist] : undefined
  const [settings, setSettings] = useState(false)
  if (!library || !session?.sync) return null
  const sync = session.sync, busy = syncBusy(library.id)
  const status = { queued: 'Sync pending', syncing: 'Syncing…', synced: 'Synced', paused: 'Sync paused', waiting: 'Waiting for playback to stop', error: 'Needs attention', recovery: 'Recovery required' }[sync.status]
  return <>
    <span className={`save-status ${sync.status === 'synced' ? '' : 'unsaved'}`} role="status"><i />{status}</span>
    {sync.status === 'waiting' && <button className="button secondary" onClick={stopPlaybackAndSync}>Stop & sync</button>}
    {['error', 'recovery'].includes(sync.status) && <button className="button secondary" disabled={busy} onClick={requestOrderSync}>{sync.status === 'recovery' ? 'Recover sync' : 'Retry sync'}</button>}
    <button className="button secondary" onClick={() => setSettings(true)}>Sync settings</button>
    {settings && <Dialog title="Filename sync settings" close={() => setSettings(false)}>
      <p><strong>{sync.mode === 'both' ? 'Numbered filenames + M3U8' : 'Numbered filenames only'}</strong><br />Folder: {sync.folder || 'Library root'}</p>
      <p>Every audio file in this folder appears once. Adding or removing playlist entries is available after disabling filename sync. Audio files are never deleted.</p>
      {sync.error && <p className="callout" role="alert">{sync.error}</p>}
      <p className="muted">Disabling keeps current filenames. Filename-only mode then becomes an unsaved M3U8 draft; it creates no file until you Save or Export.</p>
      <p>Prefer unnumbered filenames? Review and remove the numbers while keeping your playlist order.</p>
      <button className="button secondary" disabled={busy || !!library.syncRecovery} onClick={() => { setSettings(false); removeNumbers(sync.folder) }}>Remove filename numbers…</button>
      <div className="dialog-actions"><button className="button secondary" disabled={busy || !!library.syncRecovery} onClick={pauseOrderSync}>{sync.enabled ? 'Pause sync' : 'Resume sync'}</button><button className="button secondary" disabled={busy || !!library.syncRecovery} onClick={() => { if (disableOrderSync()) setSettings(false) }}>Disable filename sync</button></div>
    </Dialog>}
  </>
}
