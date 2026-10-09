import { useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { removeFilenameNumbers, syncBusy } from '../../app/orderSync'
import { message, useApp } from '../../app/store'
import { dirname, naturalCompare } from '../../domain/models'
import { planNumberRemoval, type RenameIntent } from '../../domain/orderSync'
import { player, usePlayer } from '../../playback/player'
import { Dialog } from '../shared/Dialog'

export function RemoveFilenameNumbers({ libraryId, initialFolder, close }: { libraryId: string; initialFolder?: string; close: () => void }) {
  const library = useApp(state => state.libraries.find(item => item.id === libraryId))!
  const playbackBlocked = usePlayer(state => !!state.current && state.context?.libraryId === libraryId && !state.renameSafe)
  const folders = [...new Set(Object.values(library.tracks).map(track => dirname(track.path)))].sort(naturalCompare)
  const [folder, setFolder] = useState(initialFolder ?? folders[0] ?? '')
  const [reviewed, setReviewed] = useState<string>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const parent = useRef<HTMLDivElement>(null)
  let preview: RenameIntent[] = [], previewError: string | undefined
  try { preview = planNumberRemoval(library.tracks, folder, library.files, 'preview') }
  catch (reason) { previewError = message(reason) }
  const signature = JSON.stringify(preview.map(({ source, target, trackId }) => [source, target, trackId]))
  const confirmed = reviewed === signature
  const list = useVirtualizer({ count: preview.length, getScrollElement: () => parent.current, estimateSize: () => 58, overscan: 6 })
  const owner = Object.values(library.sessions).find(session => session.sync?.folder === folder)
  const unavailable = !library.connected || library.scanning || !!library.scanError || !!library.syncRecovery || syncBusy(libraryId) || playbackBlocked
  async function remove() {
    setWorking(true); setError(undefined)
    try { await removeFilenameNumbers(libraryId, folder, preview); close() }
    catch (reason) { setError(message(reason)) }
    finally { setWorking(false) }
  }
  return <Dialog title="Remove filename numbers" wide className="playlist-create" close={() => { if (!working) close() }}>
    <p className="dialog-intro">Remove one leading number and its separators, such as “001 - Song.flac” → “Song.flac”. Review every change below; names without a numeric prefix stay as they are.</p>
    <label className="field">Audio folder<select aria-label="Audio folder" value={folder} disabled={working} onChange={event => { setFolder(event.target.value); setReviewed(undefined); setError(undefined) }}>{folders.map(path => <option key={path} value={path}>{path || 'Library root'}</option>)}</select></label>
    <p className="callout">Matching LRC files and references in playlists inside this library are updated. Playlist order stays the same. Keep other apps from editing this folder during the change.</p>
    {owner && <p className="muted">Automatic filename sync for “{owner.name}” will be turned off. {owner.sync?.mode === 'filenames' ? 'Its order becomes an unsaved M3U8 draft. Save or Export it afterward to keep that order outside Meloark.' : 'Its M3U8 keeps your current playlist order.'}</p>}
    {previewError && <p className="field-error" role="alert">{previewError}</p>}
    {!previewError && !preview.length && <p className="muted">No filename numbers to remove in this folder.</p>}
    {!!preview.length && <><p className="muted">{preview.filter(move => move.trackId).length} audio filenames and {preview.filter(move => !move.trackId).length} lyric filenames will change.</p><div className="sync-preview" ref={parent} aria-label="Number removal preview"><div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => { const move = preview[item.index]; return <div key={move.source} style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}><span>{item.index + 1}</span><span title={`${move.source} → ${move.target}`}>{move.source}<small>→ {move.target}</small></span></div> })}</div></div></>}
    <label className="review-confirm"><input type="checkbox" checked={confirmed} disabled={working || unavailable || !!previewError || !preview.length} onChange={event => setReviewed(event.target.checked ? signature : undefined)} />I reviewed these changes and want to remove the filename numbers.</label>
    <p className="muted">This requires direct folder write access and native rename support.</p>
    {playbackBlocked && <p className="callout">Stop playback to rename this disk-backed track. <button className="text-button" disabled={working} onClick={() => player.stop()}>Stop playback</button></p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {library.syncRecovery && <p role="alert" className="field-error">Close this dialog and recover filename sync before making another change.</p>}
    <div className="dialog-actions"><button className="button secondary" disabled={working} onClick={close}>Cancel</button><button className="button primary" disabled={working || unavailable || !!previewError || !preview.length || !confirmed} onClick={() => { void remove() }}>{working ? 'Removing numbers…' : 'Remove numbers'}</button></div>
  </Dialog>
}
