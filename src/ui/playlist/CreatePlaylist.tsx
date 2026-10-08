import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileMusic, ListOrdered } from 'lucide-react'
import { analyzeIndexes } from '../../domain/filenameIndex'
import { activeSession, createPlaylist, loadPlaylist, message, playlistNameError, savePlaylist, useApp } from '../../app/store'
import { createSyncedPlaylist } from '../../app/orderSync'
import { dirname, filename, naturalCompare } from '../../domain/models'
import { filenameStem, planNames } from '../../domain/orderSync'
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
  const [authority, setAuthority] = useState('')
  const [working, setWorking] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState<string>()
  const [created, setCreated] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const parent = useRef<HTMLDivElement>(null)
  const ordered = Object.values(library.tracks).filter(track => dirname(track.path) === folder).sort((a, b) => naturalCompare(a.filename, b.filename))
  const existing = storage === 'both' && authority ? library.sessions[authority] : undefined
  const previewEntries = existing?.entries ?? ordered.map(track => ({ id: track.id, trackId: track.id, path: track.path, raw: track.filename, prelude: [] }))
  const initialPaths = mode === 'folder' ? ordered.map(track => track.path) : paths
  const list = useVirtualizer({ count: storage === 'm3u8' ? mode !== 'empty' ? initialPaths.length : 0 : previewEntries.length, getScrollElement: () => parent.current, estimateSize: () => storage === 'm3u8' ? 42 : 58, overscan: 6 })
  let preview: ReturnType<typeof planNames> = [], previewError: string | undefined
  try { if (storage !== 'm3u8') preview = planNames(previewEntries, library.tracks, folder, Object.fromEntries(ordered.map(track => [track.id, filenameStem(track.path)])), library.files, 'preview') }
  catch (reason) { previewError = message(reason) }
  async function create() {
    setWorking(true); setError(undefined)
    try {
      if (storage === 'm3u8') {
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
      } else await createSyncedPlaylist(name.trim(), folder, storage, ordered.map(track => track.id), authority || undefined)
      close()
    } catch (reason) { setError(message(reason)); nameInput.current?.focus() }
    finally { setWorking(false) }
  }
  return <Dialog title={setup ? `Set up ${library.name}` : 'Create a playlist'} className={`playlist-create ${setup ? 'folder-setup' : ''}`} close={() => { if (!working) close() }} wide={setup || mode === 'indexes' || storage !== 'm3u8'}>
    {setup && <p className="setup-detected"><strong>{Object.keys(library.tracks).length} tracks</strong><span>{Object.values(library.tracks).filter(track => track.index !== null).length} numbered filenames</span><span>{library.playlists.length} playlist files</span></p>}
    <p className="dialog-intro">{setup ? 'Choose how this folder should remember your order. Then drag tracks to make it yours.' : 'Keep your order in a playlist, in the filenames, or in both.'}</p>
    <fieldset className="sync-options"><legend>Store playlist order</legend>{([
      ['m3u8', 'M3U8 only', 'Keep track order in a playlist. Audio filenames stay unchanged.'],
      ['filenames', 'Numbered filenames only', 'Automatically number one complete audio folder. No M3U8 is created.'],
      ['both', 'Numbered filenames + M3U8', 'Keep filenames and a dedicated M3U8 in the same order.'],
    ] as const).map(([value, label, description]) => <label key={value}><input type="radio" name="storage-mode" checked={storage === value} disabled={created || working || value !== 'm3u8' && (library.kind !== 'direct' || !navigator.locks)} onChange={() => { setStorage(value); setConfirmed(false); setError(undefined); setAuthority('') }} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>
    {library.kind !== 'direct' && <p className="muted">Filename sync requires a direct-access folder in a desktop Chromium browser.</p>}
    <label className="field">{storage === 'both' && authority ? 'Order-authority playlist' : 'Playlist name'}<input ref={nameInput} value={storage === 'both' && authority ? filename(authority) : name} readOnly={created || working || storage === 'both' && !!authority} aria-invalid={!!error} aria-describedby={error ? 'playlist-name-error' : undefined} onChange={event => { setName(event.target.value); setError(undefined) }} autoFocus placeholder="My playlist" /></label>
    {error && <div id="playlist-name-error" className="field-error" role="alert"><p>{error}</p>{error.includes('already exists') && <button className="text-button" onClick={() => { let index = 2; let next = `${name.replace(/\.m3u8$/i, '')} ${index}`; while (playlistNameError(next, library)?.includes('already exists')) next = `${name.replace(/\.m3u8$/i, '')} ${++index}`; setName(next); setError(undefined); nameInput.current?.focus() }}>Use an available name</button>}</div>}
    {storage === 'm3u8' && !setup && <div className="mode-options">
      <label className={mode === 'empty' ? 'chosen' : ''}><input type="radio" name="initial-order" checked={mode === 'empty'} onChange={() => setMode('empty')} /><FileMusic /><span><strong>Start empty</strong><small>Add tracks from your library</small></span></label>
      <label className={mode === 'indexes' ? 'chosen' : ''}><input type="radio" name="initial-order" checked={mode === 'indexes'} disabled={!paths.length} onChange={() => setMode('indexes')} /><ListOrdered /><span><strong>Review filename order</strong><small>Use folder-local numbered filenames as a starting point</small></span></label>
    </div>}
    {storage === 'm3u8' && setup && <label className="field">Initial order<select aria-label="Initial playlist order" value={mode} disabled={working || created} onChange={event => setMode(event.target.value as typeof mode)}><option value="folder">Filename order · {ordered.length} tracks in this folder</option><option value="indexes">Review numbered order · all {paths.length} tracks</option><option value="empty">Start empty · add tracks later</option></select></label>}
    {storage === 'm3u8' && mode === 'folder' && <><label className="field">Audio folder<select aria-label="Audio folder" value={folder} disabled={working} onChange={event => setFolder(event.target.value)}>{folders.map(path => <option key={path} value={path}>{path || 'Library root'}</option>)}</select></label><p className="callout">Start with {ordered.length} tracks. Audio filenames stay unchanged. {library.kind === 'direct' ? 'Set up saves an M3U8 in this library.' : 'Export your playlist to keep its order.'}</p></>}
    {storage === 'm3u8' && mode === 'indexes' && <>
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
    {storage !== 'm3u8' && <>
      <label className="field">Audio folder<select aria-label="Audio folder" value={folder} disabled={working} onChange={event => { setFolder(event.target.value); setConfirmed(false); setAuthority('') }}>{folders.map(path => <option key={path} value={path}>{path || 'Library root'}</option>)}</select></label>
      {storage === 'both' && <label className="field">Initial order<select aria-label="Initial sync order" value={authority} disabled={working} onChange={event => { const path = event.target.value; setAuthority(path); setConfirmed(false); if (path && !library.sessions[path]) { setWorking(true); void loadPlaylist(path).catch(reason => setError(message(reason))).finally(() => setWorking(false)) } }}><option value="">Filename order · new M3U8</option>{library.playlists.filter(path => /\.m3u8$/i.test(path)).map(path => <option key={path} value={path}>Existing playlist order · {path}</option>)}</select></label>}
      <p className="callout">Drag to keep all {previewEntries.length} tracks in order. {storage === 'both' ? 'Numbered filenames and an M3U8 update together.' : 'Only numbered filenames store the order.'} Matching LRC files and references in accessible playlists follow the renamed tracks. Keep other apps from editing this folder during sync.</p>
      {previewError && <p className="field-error" role="alert">{previewError}</p>}
      <div className="sync-preview" ref={parent} aria-label="Filename changes preview"><div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => { const entry = previewEntries[item.index]; return <div key={entry.id} style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}><span>{item.index + 1}</span><span>{entry.path}<small>→ {preview.find(move => move.trackId === entry.trackId)?.target ?? entry.path}</small></span></div> })}</div></div>
      <label className="review-confirm"><input type="checkbox" checked={confirmed} disabled={working || !!previewError} onChange={event => setConfirmed(event.target.checked)} />I reviewed this folder and order and want automatic file renaming.</label>
      <p className="muted">Enable asks for write access and tests native rename on a disposable file before touching music.</p>
    </>}
    <div className="dialog-actions"><button className="button secondary" disabled={working} onClick={close}>{created ? 'Open draft' : setup ? 'Browse first' : 'Cancel'}</button><button className="button primary" disabled={working || !name.trim() || (storage === 'm3u8' ? mode === 'indexes' && !reviewed : !confirmed || !!previewError || !previewEntries.length)} onClick={() => { void create() }}>{working ? 'Checking folder…' : created ? 'Retry save' : setup ? 'Set up playlist' : storage === 'm3u8' ? 'Create draft' : 'Enable filename sync'}</button></div>
  </Dialog>
}
