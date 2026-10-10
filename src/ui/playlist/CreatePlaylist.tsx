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
  return <Dialog title={setup ? `Set up ${library.name}` : 'Create a playlist'} className={`playlist-create ${setup ? 'folder-setup' : ''}`} close={() => { if (!working) close() }} wide={setup || mode === 'indexes' || storage !== 'm3u8'}>
    {setup && <p className="setup-detected"><strong>{Object.keys(library.tracks).length} tracks</strong><span>{Object.values(library.tracks).filter(track => track.index !== null).length} numbered filenames</span><span>{library.playlists.length} playlist files</span></p>}
    <p className="dialog-intro">{setup ? 'Set up a playlist to arrange and play this folder. Choose how to remember your order; after setup, drag songs in the Playlist tab.' : 'Keep your order in a playlist, in the filenames, or in both. After creating it, drag songs in the Playlist tab to arrange them.'}</p>
    <fieldset className="sync-options"><legend>Store playlist order</legend>{([
      ['m3u8', 'M3U8 only', 'Keep track order in a playlist. Audio filenames stay unchanged.'],
      ['filenames', 'Numbered filenames only', 'Automatically number one complete audio folder. No M3U8 is created.'],
      ['both', 'Numbered filenames + M3U8', 'Keep filenames and a dedicated M3U8 in the same order.'],
    ] as const).map(([value, label, description]) => <label key={value}><input type="radio" name="storage-mode" checked={storage === value} disabled={created || working || inspecting || value !== 'm3u8' && (library.kind !== 'direct' || !navigator.locks)} onChange={() => { setStorage(value); setChoice(''); setConfirmed(false); setError(undefined) }} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>
    {library.kind !== 'direct' && <p className="muted">Filename sync requires a direct-access folder in a desktop Chromium browser.</p>}
    {(setup || storage !== 'm3u8') && <label className="field">Audio folder<select aria-label="Audio folder" value={folder} disabled={working || created || inspecting} onChange={event => selectFolder(event.target.value)}>{folders.map(path => <option key={path} value={path}>{path || 'Library root'}</option>)}</select></label>}
    {!!library.playlists.filter(path => /\.m3u8$/i.test(path)).length && <>
      <p className="callout">{inspecting ? 'Inspecting existing playlists…' : 'Existing playlists found. Use one to keep its order and avoid creating another file. Playlist names do not need to match the folder.'}</p>
      {chooseSource && <p className="muted">Several playlists contain this folder. Choose which one to use, or explicitly create a new playlist.</p>}
      <label className="field">{storage === 'both' ? 'Initial order' : 'Playlist file'}<select aria-label={storage === 'both' ? 'Initial sync order' : 'Playlist file'} value={chooseSource ? '@choose' : authority ?? ''} disabled={working || created || inspecting} onChange={event => selectAuthority(event.target.value)}>
        {chooseSource && <option value="@choose" disabled>Choose an existing playlist or create a new one</option>}
        <option value="">{storage === 'both' ? 'Filename order · new M3U8' : storage === 'filenames' ? 'Filename order · no new M3U8' : 'Create a new M3U8'}</option>
        {inspection.items.map(item => {
          const incompatible = item.error ?? (findPlaylistSession(library, item.path)?.sync ? 'already uses sync' : storage !== 'm3u8' && item.review ? folderOrderError(item.review.document.entries, library, folder) : undefined)
          return <option key={item.path} value={item.path} disabled={!!incompatible}>Existing playlist order · {item.path}{incompatible ? ' · unavailable for this folder' : ''}</option>
        })}
      </select></label>
      {selectionError && <p className="field-error" role="alert">{selectionError}</p>}
      {inspection.items.some(item => item.error) && <p className="muted">Some playlists could not be read: {inspection.items.filter(item => item.error).map(item => `${item.path}: ${item.error}`).join('; ')}</p>}
      {storage !== 'm3u8' && inspection.items.some(item => item.review && folderOrderError(item.review.document.entries, library, folder)) && <p className="muted">Filename sync needs every audio file in the selected folder exactly once. Playlists with missing tracks, duplicates, other folders or only some of these tracks can be opened in M3U8-only mode.</p>}
      <button className="text-button" disabled={working || inspecting || created} onClick={() => { setRefresh(value => value + 1); setChoice(''); setConfirmed(false); setError(undefined) }}>Inspect playlists again</button>
    </>}
    {review && <>
      <p className="callout">{ordersDiffer ? 'The saved M3U8 order differs from filename order.' : 'The saved M3U8 and filenames have the same track order.'} {storage === 'm3u8' ? 'Opening it keeps audio filenames unchanged. Choose numbered filenames + M3U8 to keep both in step.' : storage === 'both' ? `Your chosen order will be saved in ${review.path} and the numbered filenames.` : 'Your chosen order will be stored in the numbered filenames.'}</p>
      {(needsChoice || storage !== 'm3u8') && <fieldset className="mode-options" disabled={working || created || inspecting}><legend>Choose the starting order</legend>
        <label className={selectedChoice === 'saved' ? 'chosen' : ''}><input type="radio" name="order-authority" checked={selectedChoice === 'saved'} onChange={() => { setChoice('saved'); setConfirmed(false) }} /><span><strong>Use saved M3U8 order</strong><small>Read from {review.path}</small></span></label>
        {storage !== 'm3u8' && <label className={selectedChoice === 'filenames' ? 'chosen' : ''}><input type="radio" name="order-authority" checked={selectedChoice === 'filenames'} onChange={() => { setChoice('filenames'); setConfirmed(false) }} /><span><strong>Use filename order</strong><small>{storage === 'both' ? 'Replace this M3U8’s sequence with the folder order' : 'Keep the folder’s current filename order'}</small></span></label>}
        {draftDiffers && <label className={selectedChoice === 'draft' ? 'chosen' : ''}><input type="radio" name="order-authority" checked={selectedChoice === 'draft'} onChange={() => { setChoice('draft'); setConfirmed(false) }} /><span><strong>Use current draft order</strong><small>Includes your unsaved rearrangements in Meloark</small></span></label>}
      </fieldset>}
      {needsChoice && !selectedChoice && <p className="muted">Choose an order to see the preview and continue.</p>}
    </>}
    <label className="field">{storage !== 'filenames' && authority ? 'Order-authority playlist' : 'Playlist name'}<input ref={nameInput} value={storage !== 'filenames' && authority ? filename(authority) : name} readOnly={created || working || storage !== 'filenames' && !!authority} aria-invalid={!!error} aria-describedby={error ? 'playlist-name-error' : undefined} onChange={event => { setName(event.target.value); setError(undefined) }} autoFocus placeholder="My playlist" /></label>
    {error && <div id="playlist-name-error" className="field-error" role="alert"><p>{error}</p>{error.includes('already exists') && <button className="text-button" onClick={() => { let index = 2; let next = `${name.replace(/\.m3u8$/i, '')} ${index}`; while (playlistNameError(next, library)?.includes('already exists')) next = `${name.replace(/\.m3u8$/i, '')} ${++index}`; setName(next); setError(undefined); nameInput.current?.focus() }}>Use an available name</button>}</div>}
    {storage === 'm3u8' && !authority && !setup && <div className="mode-options">
      <label className={mode === 'empty' ? 'chosen' : ''}><input type="radio" name="initial-order" checked={mode === 'empty'} onChange={() => setMode('empty')} /><FileMusic /><span><strong>Start empty</strong><small>Add tracks from your library</small></span></label>
      <label className={mode === 'indexes' ? 'chosen' : ''}><input type="radio" name="initial-order" checked={mode === 'indexes'} disabled={!paths.length} onChange={() => setMode('indexes')} /><ListOrdered /><span><strong>Review filename order</strong><small>Use folder-local numbered filenames as a starting point</small></span></label>
    </div>}
    {storage === 'm3u8' && !authority && setup && <label className="field">Initial order<select aria-label="Initial playlist order" value={mode} disabled={working || created} onChange={event => setMode(event.target.value as typeof mode)}><option value="folder">Filename order · {ordered.length} tracks in this folder</option><option value="indexes">Review numbered order · all {paths.length} tracks</option><option value="empty">Start empty · add tracks later</option></select></label>}
    {storage === 'm3u8' && !authority && mode === 'folder' && <><p className="callout">Start with {ordered.length} tracks. Audio filenames stay unchanged. {library.kind === 'direct' ? 'Set up saves an M3U8 in this library.' : 'Export your playlist to keep its order.'}</p></>}
    {storage === 'm3u8' && !authority && mode === 'indexes' && <>
      <div className="review-issues">
        {groups.length > 1 && <p className="callout">{groups.length} folders are grouped by folder name below. Their indexes are independent. Review the combined order before creating.</p>}
        {groups.map(group => group.issues.length ? <div key={group.folder}><strong>{group.folder || 'Library root'}</strong>{group.issues.map(issue => <p key={issue}>{issue}</p>)}</div> : null)}
      </div>
      <div className="review-list" ref={parent}><div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => <div key={paths[item.index]} className="review-row" style={{ position: 'absolute', top: item.start, width: '100%' }}>
        <span className="row-number">{item.index + 1}</span><span title={paths[item.index]}>{paths[item.index]}</span>
      </div>)}</div></div>
      <label className="review-confirm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the displayed order, including ties and unindexed tracks.</label>
      <p className="muted">Adjust the order by dragging tracks after creating the draft.</p>
    </>}
    {storage === 'm3u8' && authority && !!previewEntries.length && <div className="review-list" ref={parent} aria-label="Playlist order preview"><div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => <div key={previewEntries[item.index].id} className="review-row" style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}><span className="row-number">{item.index + 1}</span><span>{previewEntries[item.index].path ?? previewEntries[item.index].raw}</span></div>)}</div></div>}
    {storage !== 'm3u8' && <>
      {!!previewEntries.length && <p className="callout">Preview only — arrange these {previewEntries.length} tracks by dragging in the Playlist tab after {setup ? 'setup' : 'creating the playlist'}. {storage === 'both' ? 'Numbered filenames and an M3U8 update together.' : 'Only numbered filenames store the order.'} Matching LRC files and references in accessible playlists follow the renamed tracks. Other playlists keep their own sequence; their file references follow renames. Keep other apps from editing this folder during sync.</p>}
      {previewError && <p className="field-error" role="alert">{previewError}</p>}
      <div className="sync-preview" ref={parent} aria-label="Filename changes preview"><div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => { const entry = previewEntries[item.index]; return <div key={entry.id} style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}><span>{item.index + 1}</span><span>{entry.path}<small>→ {preview.find(move => move.trackId === entry.trackId)?.target ?? entry.path}</small></span></div> })}</div></div>
      <label className="review-confirm"><input type="checkbox" checked={confirmed} disabled={blocked || !!previewError || !previewEntries.length} onChange={event => setConfirmed(event.target.checked)} />I reviewed this folder and order and want automatic file renaming.</label>
      <p className="muted">Enable asks for write access and tests native rename on a disposable file before touching music.</p>
    </>}
    <div className="dialog-actions"><button className="button secondary" disabled={working} onClick={close}>{created ? 'Open draft' : setup ? 'Browse first' : 'Cancel'}</button><button className="button primary" disabled={blocked || (storage === 'filenames' || !authority) && !name.trim() || (storage === 'm3u8' ? !authority && mode === 'indexes' && !reviewed : !confirmed || !!previewError || !previewEntries.length)} onClick={() => { void create() }}>{working ? 'Checking folder…' : created ? 'Retry save' : storage === 'm3u8' && authority ? 'Use existing playlist' : setup ? 'Set up playlist' : storage === 'm3u8' ? 'Create draft' : 'Enable filename sync'}</button></div>
  </Dialog>
}
