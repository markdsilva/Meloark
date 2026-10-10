import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileMusic, ListOrdered } from 'lucide-react'
import { analyzeIndexes } from '../../domain/filenameIndex'
import { activeSession, createPlaylist, findPlaylistSession, message, playlistNameError, savePlaylist, useApp } from '../../app/store'
import { createSyncedPlaylist } from '../../app/orderSync'
import { dirname, filename, naturalCompare } from '../../domain/models'
import { filenameStem, planNames } from '../../domain/orderSync'
import { adoptPlaylistOrder, filenameEntries, folderOrderError, inspectPlaylistOrder, reviewedEntries, sameTrackOrder, type PlaylistOrderChoice, type PlaylistOrderReview } from '../../app/playlistOrder'
import { Dialog } from '../shared/Dialog'
import { Select } from '../shared/Select'

export function CreatePlaylist({ close, setup = false }: { close: () => void; setup?: boolean }) {
  const library = useApp(s => s.libraries.find(l => l.id === s.activeLibrary))!
  const groups = useMemo(() => analyzeIndexes(Object.values(library.tracks)), [library.tracks])
  const [name, setName] = useState(() => {
    if (!setup) return 'My playlist'
    const base = [...library.name].map(char => char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '-' : char).join('').replace(/[. ]+$/, '') || 'My playlist'
    let candidate = base, index = 2
    while (playlistNameError(candidate, library)) candidate = `${base} ${index++}`
    return candidate
  })
  const [mode, setMode] = useState<'empty' | 'indexes' | 'folder'>(setup ? 'folder' : 'empty')
  const [paths] = useState(() => groups.flatMap(group => group.tracks.map(track => track.path)))
  const [storage, setStorage] = useState<'m3u8' | 'filenames' | 'both'>('m3u8')
  const folders = [...new Set(Object.values(library.tracks).map(track => dirname(track.path)))].sort(naturalCompare)
  const [folder, setFolder] = useState(folders[0] ?? '')
  const [authority, setAuthority] = useState<string | null>(setup ? null : '')
  const [sourceChosen, setSourceChosen] = useState(!setup)
  const [choice, setChoice] = useState<PlaylistOrderChoice | ''>('')
  const [inspection, setInspection] = useState<{ key: string; items: { path: string; review?: PlaylistOrderReview; error?: string }[] }>({ key: '', items: [] })
  const [refresh, setRefresh] = useState(0)
  const playlistKey = JSON.stringify(library.playlists.filter(path => /\.m3u8$/i.test(path)))
  const inspectionKey = `${library.id}:${library.generation}:${folder}:${playlistKey}:${refresh}`
  const inspecting = inspection.key !== inspectionKey
  useEffect(() => {
    let cancelled = false
    const currentLibrary = useApp.getState().libraries.find(item => item.id === library.id)!
    const paths: string[] = JSON.parse(playlistKey)
    void Promise.all(paths.map(async path => {
      try { return { path, review: await inspectPlaylistOrder(path, library.id) } }
      catch (reason) { return { path, error: message(reason) } }
    })).then(items => {
      if (cancelled) return
      setInspection({ key: inspectionKey, items })
      const candidates = items.filter(item => item.review && !findPlaylistSession(currentLibrary, item.path)?.sync && !folderOrderError(item.review.document.entries, currentLibrary, folder))
      setAuthority(current => current === null ? setup && candidates.length === 1 ? candidates[0].path : '' : current)
    })
    return () => { cancelled = true }
  }, [playlistKey, inspectionKey, library.id, folder, setup])
  const [working, setWorking] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState<string>()
  const [created, setCreated] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const parent = useRef<HTMLDivElement>(null)
  const orderedEntries = filenameEntries(library, folder)
  const ordered = orderedEntries.map(entry => library.tracks[entry.trackId!])
  const selected = authority ? inspection.items.find(item => item.path === authority) : undefined
  const existing = authority ? findPlaylistSession(library, authority) : undefined
  const review = selected?.review
  const compatible = inspection.items.filter(item => item.review && !findPlaylistSession(library, item.path)?.sync && !folderOrderError(item.review.document.entries, library, folder))
  const chooseSource = setup && !sourceChosen && !authority && compatible.length > 1
  const draftDiffers = !!review?.draft && !sameTrackOrder(review.draft, review.document.entries)
  const ordersDiffer = !!review && !sameTrackOrder(review.document.entries, orderedEntries)
  const needsChoice = !!review && (draftDiffers || storage !== 'm3u8' && ordersDiffer)
  const selectedChoice = choice || (needsChoice ? undefined : 'saved')
  const selectionError = selected?.error ?? (authority && !review ? 'Inspect this playlist before using its order.' : existing?.sync ? 'This playlist already uses filename sync. Disable it before setting up another order.' : existing?.status === 'unverified' ? 'Reconcile this playlist’s unverified save before using it.' : undefined)
  const initialPaths = mode === 'folder' ? ordered.map(track => track.path) : paths
  const previewEntries = review && selectedChoice ? reviewedEntries(review, selectedChoice, library, folder) : authority ? [] : orderedEntries
  const previewCount = authority || storage !== 'm3u8' ? previewEntries.length : mode !== 'empty' ? initialPaths.length : 0
  const previewRowHeight = storage === 'm3u8' ? 42 : 58
  const list = useVirtualizer({ count: previewCount, getScrollElement: () => parent.current, estimateSize: () => previewRowHeight, overscan: 6 })
  // The virtualizer caches estimates; switching to two-line filename previews
  // must discard the previous mode's shorter rows before painting.
  useLayoutEffect(() => { list.measure() }, [list, previewRowHeight])
  let preview: ReturnType<typeof planNames> = [], previewError: string | undefined
  try { if (storage !== 'm3u8' && previewEntries.length) preview = planNames(previewEntries, library.tracks, folder, Object.fromEntries(ordered.map(track => [track.id, filenameStem(track.path)])), library.files, 'preview') }
  catch (reason) { previewError = message(reason) }
  const targets = new Map(preview.map(move => [move.trackId, move.target]))
  const blocked = working || inspecting || chooseSource || !!selectionError || !!authority && !selectedChoice
  function selectAuthority(path: string) { setAuthority(path); setSourceChosen(true); setChoice(''); setConfirmed(false); setError(undefined) }
  function selectFolder(path: string) { setFolder(path); selectAuthority('') }
  async function create() {
    setWorking(true); setError(undefined)
    try {
      if (authority && (!review || !selectedChoice)) throw new Error('Choose and inspect the starting order before continuing.')
      if (storage === 'm3u8' && review && selectedChoice) {
        if (selectedChoice === 'filenames') throw new Error('Choose the saved file or current draft order to open this playlist.')
        await adoptPlaylistOrder(review, selectedChoice)
      } else if (storage === 'm3u8') {
        if (!created) {
          const result = createPlaylist(name.trim(), mode !== 'empty' ? initialPaths : undefined, false)
          if (!result.ok) throw new Error(result.error)
          setCreated(true)
        }
        if (setup && library.kind === 'direct') {
          await savePlaylist()
          const session = activeSession()
          if (session?.error) throw new Error(session.error)
        }
      } else await createSyncedPlaylist(name.trim(), folder, storage, ordered.map(track => track.id), authority || undefined, review && selectedChoice ? { review, choice: selectedChoice } : undefined)
      close()
    } catch (reason) { setError(message(reason)); nameInput.current?.focus() }
    finally { setWorking(false) }
  }
  return <Dialog title={setup ? `Set up ${library.name}` : 'Create a playlist'} className={`playlist-create ${setup ? 'folder-setup' : ''}`} close={() => { if (!working) close() }} wide>
    {setup && <p className="setup-detected"><strong>{Object.keys(library.tracks).length} tracks</strong></p>}
    <p className="dialog-intro">Choose how to save this playlist’s order.</p>
    <div className="setup-heading"><h3 id="storage-heading">Choose playlist order</h3>{(library.kind !== 'direct' || !navigator.locks) && <small>Filename sync needs direct folder access and browser locks.</small>}</div>
    <fieldset className="sync-options" aria-labelledby="storage-heading">{([
      ['m3u8', 'M3U8 only', 'Save a playlist. Keep filenames unchanged.'],
      ['filenames', 'Numbered filenames only', 'Number every track in one folder. No M3U8.'],
      ['both', 'Numbered filenames + M3U8', 'Keep numbered files and an M3U8 in the same order.'],
    ] as const).map(([value, label, description]) => <label key={value}><input type="radio" name="storage-mode" checked={storage === value} disabled={created || working || inspecting || value !== 'm3u8' && (library.kind !== 'direct' || !navigator.locks)} onChange={() => { setStorage(value); setChoice(''); setConfirmed(false); setError(undefined) }} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>
    <label className="field">{storage !== 'filenames' && authority ? 'Playlist file' : 'Playlist name'}<input ref={nameInput} value={storage !== 'filenames' && authority ? filename(authority) : name} readOnly={created || working || storage !== 'filenames' && !!authority} aria-invalid={!!error} aria-describedby={error ? 'playlist-name-error' : undefined} onChange={event => { setName(event.target.value); setError(undefined) }} autoFocus placeholder="My playlist" /></label>
    {error && <div id="playlist-name-error" className="field-error" role="alert"><p>{error}</p>{error.includes('already exists') && <button className="text-button" onClick={() => { let index = 2; let next = `${name.replace(/\.m3u8$/i, '')} ${index}`; while (playlistNameError(next, library)?.includes('already exists')) next = `${name.replace(/\.m3u8$/i, '')} ${++index}`; setName(next); setError(undefined); nameInput.current?.focus() }}>Use an available name</button>}</div>}
    <div className="setup-fields">
      {(setup || storage !== 'm3u8') && <Select label="Audio folder" value={folder} disabled={working || created || inspecting} onChange={selectFolder} options={folders.map(path => ({ value: path, label: path || 'Library root' }))} />}
      {!!library.playlists.filter(path => /\.m3u8$/i.test(path)).length && <Select label="Playlist source" accessibleLabel={storage === 'both' ? 'Initial sync order' : 'Playlist source'} value={chooseSource ? '@choose' : authority ?? ''} disabled={working || created || inspecting} onChange={selectAuthority} options={[
        ...(chooseSource ? [{ value: '@choose', label: 'Choose a playlist or create one', disabled: true }] : []),
        { value: '', label: storage === 'both' ? 'Filename order · new M3U8' : storage === 'filenames' ? 'Filename order · no M3U8' : 'Create a new M3U8' },
        ...inspection.items.map(item => {
          const incompatible = item.error ?? (findPlaylistSession(library, item.path)?.sync ? 'Already uses filename sync' : storage !== 'm3u8' && item.review ? folderOrderError(item.review.document.entries, library, folder) : undefined)
          return { value: item.path, label: item.path, disabled: !!incompatible, reason: incompatible }
        }),
      ]} />}
      {storage === 'm3u8' && !authority && setup && <Select label="Starting order" accessibleLabel="Initial playlist order" value={mode} disabled={working || created} onChange={value => setMode(value as typeof mode)} options={[{ value: 'folder', label: `Filename order · ${ordered.length} tracks` }, { value: 'indexes', label: `Numbered order · all ${paths.length} tracks` }, { value: 'empty', label: 'Start empty' }]} />}
    </div>
    {!!library.playlists.filter(path => /\.m3u8$/i.test(path)).length && <>
      {inspecting && <p className="muted" role="status">Reading existing playlists…</p>}
      {chooseSource && <p className="callout">Several playlists contain this folder. Choose one or create a new playlist.</p>}
      {selectionError && <p className="field-error" role="alert">{selectionError}</p>}
      {inspection.items.some(item => item.error) && <p className="callout">Could not read: {inspection.items.filter(item => item.error).map(item => `${item.path}: ${item.error}`).join('; ')}</p>}
      {storage !== 'm3u8' && inspection.items.some(item => item.review && folderOrderError(item.review.document.entries, library, folder)) && <p className="muted">Filename sync requires every track in one folder exactly once. Other playlists can use M3U8-only mode.</p>}
      <button className="text-button" disabled={working || inspecting || created} onClick={() => { setRefresh(value => value + 1); setChoice(''); setConfirmed(false); setError(undefined) }}>Read playlists again</button>
    </>}
    {review && <>
      <p className="callout">{ordersDiffer ? 'Saved playlist and filename order differ.' : 'Saved playlist and filename order match.'} {storage === 'm3u8' ? 'Filenames stay unchanged in M3U8-only mode.' : storage === 'both' ? `This order will update ${review.path} and numbered filenames.` : 'This order will number the audio files.'}</p>
      {(needsChoice || storage !== 'm3u8') && <fieldset className="mode-options" disabled={working || created || inspecting}><legend>Choose the starting order</legend>
        <label className={selectedChoice === 'saved' ? 'chosen' : ''}><input type="radio" name="order-authority" checked={selectedChoice === 'saved'} onChange={() => { setChoice('saved'); setConfirmed(false) }} /><span><strong>Use saved M3U8 order</strong><small>Read from {review.path}</small></span></label>
        {storage !== 'm3u8' && <label className={selectedChoice === 'filenames' ? 'chosen' : ''}><input type="radio" name="order-authority" checked={selectedChoice === 'filenames'} onChange={() => { setChoice('filenames'); setConfirmed(false) }} /><span><strong>Use filename order</strong><small>{storage === 'both' ? 'Replace this M3U8’s sequence with the folder order' : 'Keep the folder’s current filename order'}</small></span></label>}
        {draftDiffers && <label className={selectedChoice === 'draft' ? 'chosen' : ''}><input type="radio" name="order-authority" checked={selectedChoice === 'draft'} onChange={() => { setChoice('draft'); setConfirmed(false) }} /><span><strong>Use current draft order</strong><small>Includes your unsaved rearrangements in Meloark</small></span></label>}
      </fieldset>}
      {needsChoice && !selectedChoice && <p className="muted">Choose an order to see the preview and continue.</p>}
    </>}
    {storage === 'm3u8' && !authority && !setup && <div className="mode-options">
      <label className={mode === 'empty' ? 'chosen' : ''}><input type="radio" name="initial-order" checked={mode === 'empty'} onChange={() => setMode('empty')} /><FileMusic /><span><strong>Start empty</strong><small>Add tracks from your library</small></span></label>
      <label className={mode === 'indexes' ? 'chosen' : ''}><input type="radio" name="initial-order" checked={mode === 'indexes'} disabled={!paths.length} onChange={() => setMode('indexes')} /><ListOrdered /><span><strong>Review filename order</strong><small>Start with numbered filenames</small></span></label>
    </div>}
    {storage === 'm3u8' && !authority && mode === 'folder' && <><p className="callout">Audio filenames stay unchanged. {library.kind === 'direct' ? 'Set up saves an M3U8 in this library.' : 'Export your playlist to keep its order.'}</p></>}
    {storage === 'm3u8' && !authority && mode === 'indexes' && <>
      <div className="review-issues">
        {groups.length > 1 && <p className="callout">{groups.length} folders are grouped by folder name below. Their indexes are independent. Review the combined order before creating.</p>}
        {groups.map(group => group.issues.length ? <div key={group.folder}><strong>{group.folder || 'Library root'}</strong>{group.issues.map(issue => <p key={issue}>{issue}</p>)}</div> : null)}
      </div>
      <div className="review-list" style={{ height: Math.min(250, list.getTotalSize()) }} ref={parent}><div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => <div key={paths[item.index]} className="review-row" style={{ position: 'absolute', top: item.start, width: '100%' }}>
        <span className="row-number">{item.index + 1}</span><span title={paths[item.index]}>{paths[item.index]}</span>
      </div>)}</div></div>
      <label className="review-confirm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the displayed order, including ties and unindexed tracks.</label>
      <p className="muted">Adjust the order by dragging tracks after creating the draft.</p>
    </>}
    {storage === 'm3u8' && authority && !!previewEntries.length && <div className="review-list" style={{ height: Math.min(250, list.getTotalSize()) }} ref={parent} aria-label="Playlist order preview"><div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => <div key={previewEntries[item.index].id} className="review-row" style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}><span className="row-number">{item.index + 1}</span><span>{previewEntries[item.index].path ?? previewEntries[item.index].raw}</span></div>)}</div></div>}
    {storage !== 'm3u8' && <>
      {!!previewEntries.length && <><p className="preview-note">Preview only · Reorder tracks in the Playlist tab after setup.</p><p className="callout">{storage === 'both' ? 'Numbered filenames and the selected M3U8 will stay in the same order.' : 'Numbered filenames will store the track order.'} Keep other apps from editing this folder during sync.</p><details className="setup-details"><summary>What else changes?</summary><p>Matching LRC files and references in accessible playlists follow renamed tracks. Other playlists keep their own sequence.</p></details></>}
      {previewError && <p className="field-error" role="alert">{previewError}</p>}
      <div className="sync-preview" ref={parent} aria-label="Filename changes preview"><div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => { const entry = previewEntries[item.index]; return <div key={entry.id} style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}><span>{item.index + 1}</span><span>{entry.path}<small>→ {targets.get(entry.trackId) ?? entry.path}</small></span></div> })}</div></div>
      <label className="review-confirm"><input type="checkbox" checked={confirmed} disabled={blocked || !!previewError || !previewEntries.length} onChange={event => setConfirmed(event.target.checked)} />I reviewed this folder and order and want automatic file renaming.</label>
      <p className="muted">Requires write permission. Rename support is checked before changing music files.</p>
    </>}
    <div className="dialog-actions"><button className="button secondary" disabled={working} onClick={close}>{created ? 'Open draft' : setup ? 'Browse first' : 'Cancel'}</button><button className="button primary" disabled={blocked || (storage === 'filenames' || !authority) && !name.trim() || (storage === 'm3u8' ? !authority && mode === 'indexes' && !reviewed : !confirmed || !!previewError || !previewEntries.length)} onClick={() => { void create() }}>{working ? 'Checking folder…' : created ? 'Retry save' : storage === 'm3u8' && authority ? 'Use existing playlist' : setup ? 'Set up playlist' : storage === 'm3u8' ? 'Create draft' : 'Enable filename sync'}</button></div>
  </Dialog>
}
