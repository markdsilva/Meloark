import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { reconcileOrderSync, syncBusy } from '../../app/orderSync'
import { message, useApp } from '../../app/store'
import { folderOrderError, inspectPlaylistOrder, reviewedEntries, type PlaylistOrderReview } from '../../app/playlistOrder'
import { filenameStem, planNames } from '../../domain/orderSync'
import { Dialog } from '../shared/Dialog'
import { player, usePlayer } from '../../playback/player'

export function SyncOrderReview({ close }: { close: () => void }) {
  const library = useApp(state => state.libraries.find(item => item.id === state.activeLibrary))!
  const session = library.sessions[library.activePlaylist!]!
  const [review, setReview] = useState<PlaylistOrderReview>()
  const [choice, setChoice] = useState<'saved' | 'draft'>()
  const [confirmed, setConfirmed] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const [refresh, setRefresh] = useState(0)
  const diskPlayback = usePlayer(state => !!state.current && state.context?.libraryId === library.id && !state.renameSafe)
  const parent = useRef<HTMLDivElement>(null)
  const path = session.document!.path
  useEffect(() => {
    let cancelled = false
    void inspectPlaylistOrder(path, library.id).then(result => { if (!cancelled) setReview(result) }).catch(reason => { if (!cancelled) setError(message(reason)) })
    return () => { cancelled = true }
  }, [path, library.id, refresh])
  const entries = review && choice ? reviewedEntries(review, choice, library, session.sync!.folder) : []
  const list = useVirtualizer({ count: entries.length, getScrollElement: () => parent.current, estimateSize: () => 58, overscan: 6 })
  let preview: ReturnType<typeof planNames> = [], previewError = review ? folderOrderError(review.document.entries, library, session.sync!.folder) : undefined
  try {
    if (entries.length && !previewError) preview = planNames(entries, library.tracks, session.sync!.folder, Object.fromEntries(Object.values(library.tracks).map(track => [track.id, filenameStem(track.path)])), library.files, 'preview')
  } catch (reason) { previewError = message(reason) }
  const targets = new Map(preview.map(move => [move.trackId, move.target]))
  async function apply() {
    if (!review || !choice) return
    setWorking(true); setError(undefined)
    try { await reconcileOrderSync(review, choice); close() }
    catch (reason) { setError(message(reason)); setConfirmed(false) }
    finally { setWorking(false) }
  }
  return <Dialog title="Review playlist order" close={() => { if (!working) close() }} wide>
    <p>The saved file and Meloark may have different orders. Choose which order to keep in <strong>{path}</strong> and the numbered filenames.</p>
    <p className="muted">Other playlists keep their own sequence; their references follow renamed tracks. Keep other apps from editing this folder during sync.</p>
    {!review && !error && <p role="status">Reading the saved playlist…</p>}
    {(error || previewError) && <p role="alert" className="field-error">{error ?? previewError}</p>}
    <fieldset className="mode-options" disabled={working || !review || !!previewError}>
      <legend>Choose the order to keep</legend>
      <label className={choice === 'saved' ? 'chosen' : ''}><input type="radio" name="reconcile-order" checked={choice === 'saved'} onChange={() => { setChoice('saved'); setConfirmed(false) }} /><span><strong>Import saved M3U8 order</strong><small>Rename files to match the current saved playlist</small></span></label>
      <label className={choice === 'draft' ? 'chosen' : ''}><input type="radio" name="reconcile-order" checked={choice === 'draft'} onChange={() => { setChoice('draft'); setConfirmed(false) }} /><span><strong>Keep Meloark order</strong><small>Replace the saved playlist order with the current Meloark order</small></span></label>
    </fieldset>
    {!!entries.length && <div className="sync-preview" ref={parent} aria-label="Reconciled filename preview"><div role="list" style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => { const entry = entries[item.index]; return <div role="listitem" key={entry.id} style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}><span>{item.index + 1}</span><span>{entry.path}<small>→ {targets.get(entry.trackId) ?? entry.path}</small></span></div> })}</div></div>}
    {diskPlayback && <p className="callout">Stop disk-backed playback before renaming. <button className="text-button" disabled={working} onClick={() => player.stop()}>Stop playback</button></p>}
    <label className="review-confirm"><input type="checkbox" checked={confirmed} disabled={working || !choice || !!previewError || diskPlayback || !review} onChange={event => setConfirmed(event.target.checked)} />I reviewed this order and want the filenames and this M3U8 to match.</label>
    <div className="dialog-actions"><button className="button secondary" disabled={working} onClick={close}>Cancel</button><button className="button secondary" disabled={working} onClick={() => { setReview(undefined); setChoice(undefined); setConfirmed(false); setError(undefined); setRefresh(value => value + 1) }}>Read file again</button><button className="button primary" disabled={working || !confirmed || !choice || !!previewError || diskPlayback || !review || syncBusy(library.id)} onClick={() => { void apply() }}>{working ? 'Reconciling…' : 'Apply reviewed order'}</button></div>
  </Dialog>
}
