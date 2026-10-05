import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, FileMusic, ListOrdered } from 'lucide-react'
import { analyzeIndexes } from '../../domain/filenameIndex'
import { createPlaylist, playlistNameError, useApp } from '../../app/store'
import { Dialog } from '../shared/Dialog'

export function CreatePlaylist({ close }: { close: () => void }) {
  const library = useApp(s => s.libraries.find(l => l.id === s.activeLibrary))!
  const groups = useMemo(() => analyzeIndexes(Object.values(library.tracks)), [library.tracks])
  const [name, setName] = useState('My playlist')
  const [mode, setMode] = useState<'empty' | 'indexes'>('empty')
  const [paths, setPaths] = useState(() => groups.flatMap(group => group.tracks.map(track => track.path)))
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState<string>()
  const nameInput = useRef<HTMLInputElement>(null)
  const parent = useRef<HTMLDivElement>(null)
  const list = useVirtualizer({ count: mode === 'indexes' ? paths.length : 0, getScrollElement: () => parent.current, estimateSize: () => 42, overscan: 6 })
  function move(index: number, offset: number) {
    const after = [...paths], next = index + offset
    if (next < 0 || next >= paths.length) return
    ;[after[index], after[next]] = [after[next], after[index]]
    setPaths(after); setReviewed(false)
  }
  return <Dialog title="Create a playlist" close={close} wide={mode === 'indexes'}>
    <p className="dialog-intro">A playlist is an order of tracks. Creating or editing one never renames your music.</p>
    <label className="field">Playlist name<input ref={nameInput} value={name} aria-invalid={!!error} aria-describedby={error ? 'playlist-name-error' : undefined} onChange={event => { setName(event.target.value); setError(undefined) }} autoFocus placeholder="My playlist" /></label>
    {error && <div id="playlist-name-error" className="field-error" role="alert"><p>{error}</p>{error.includes('already exists') && <button className="text-button" onClick={() => { let index = 2; let next = `${name.replace(/\.m3u8$/i, '')} ${index}`; while (playlistNameError(next, library)?.includes('already exists')) next = `${name.replace(/\.m3u8$/i, '')} ${++index}`; setName(next); setError(undefined); nameInput.current?.focus() }}>Use an available name</button>}</div>}
    <div className="mode-options">
      <label className={mode === 'empty' ? 'chosen' : ''}><input type="radio" name="initial-order" checked={mode === 'empty'} onChange={() => setMode('empty')} /><FileMusic /><span><strong>Start empty</strong><small>Add tracks from your library</small></span></label>
      <label className={mode === 'indexes' ? 'chosen' : ''}><input type="radio" name="initial-order" checked={mode === 'indexes'} disabled={!paths.length} onChange={() => setMode('indexes')} /><ListOrdered /><span><strong>Review filename order</strong><small>Use folder-local numbered filenames as a starting point</small></span></label>
    </div>
    {mode === 'indexes' && <>
      <div className="review-issues">
        {groups.length > 1 && <p className="callout">{groups.length} folders are grouped by folder name below. Their indexes are independent. Review the combined order before creating.</p>}
        {groups.map(group => group.issues.length ? <div key={group.folder}><strong>{group.folder || 'Library root'}</strong>{group.issues.map(issue => <p key={issue}>{issue}</p>)}</div> : null)}
      </div>
      <div className="review-list" ref={parent}><div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(item => <div key={paths[item.index]} className="review-row" style={{ position: 'absolute', top: item.start, width: '100%' }}>
        <span className="row-number">{item.index + 1}</span><span title={paths[item.index]}>{paths[item.index]}</span><button className="icon-button" aria-label={`Move ${paths[item.index]} up`} disabled={!item.index} onClick={() => move(item.index, -1)}><ArrowUp size={15} /></button><button className="icon-button" aria-label={`Move ${paths[item.index]} down`} disabled={item.index === paths.length - 1} onClick={() => move(item.index, 1)}><ArrowDown size={15} /></button>
      </div>)}</div></div>
      <label className="review-confirm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the displayed order, including ties and unindexed tracks.</label>
    </>}
    <div className="dialog-actions"><button className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={!name.trim() || (mode === 'indexes' && !reviewed)} onClick={() => { const result = createPlaylist(name.trim(), mode === 'indexes' ? paths : undefined, false); if (result.ok) close(); else { setError(result.error); nameInput.current?.focus() } }}>Create draft</button></div>
  </Dialog>
}
