import { useEffect, useMemo, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react'
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Clock3, GripVertical, Music2, Pause, Play, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { addTracks, removeEntries, reorderEntries, useApp } from '../../app/store'
import { naturalCompare, type PlaylistEntry, type Track } from '../../domain/models'
import { player, usePlayer } from '../../playback/player'
import { prioritizeMetadata } from '../../metadata/scheduler'
import { Artwork } from '../shared/Artwork'
import { time } from '../shared/format'
import { ResolveEntry } from './ResolveEntry'
import { AudioDetails, AudioSummary } from '../shared/AudioDetails'
import { useMediaQuery } from '../shared/useMediaQuery'
import { audioSummary } from '../../metadata/technical'
import { Dialog } from '../shared/Dialog'

interface RowData { id: string; trackId?: string; entry?: PlaylistEntry }
function TrackRow({ row, index, selected, selectable, reorderable, selecting, onSelect, onResolve, onDetails }: {
  row: RowData; index: number; selected: boolean; selectable: boolean; reorderable: boolean
  onSelect: (event: MouseEvent | KeyboardEvent, index: number) => void; onResolve: (entry: PlaylistEntry) => void
  selecting: boolean; onDetails: (track: Track) => void
}) {
  const track = useApp(s => {
    const library = s.libraries.find(l => l.id === s.activeLibrary)
    return row.trackId ? library?.tracks[row.trackId] : undefined
  })
  const busy = useApp(s => s.busy)
  const connected = useApp(s => s.libraries.find(l => l.id === s.activeLibrary)?.connected ?? false)
  const current = usePlayer(s => s.current), playing = usePlayer(s => s.playing)
  const [actions, setActions] = useState(false)
  // Keep library row controls independent of drag accessibility attributes.
  // The domain controls order; no optimistic plugin may rearrange React's DOM.
  const drag = useDraggable({ id: row.id, disabled: !reorderable || busy, data: { index } })
  const drop = useDroppable({ id: row.id, disabled: !reorderable || busy, data: { index } })
  const isCurrent = current === row.id
  const unresolved = !!row.entry?.issue || !track
  const title = track?.metadata.title ?? row.entry?.raw ?? 'Unknown track'
  const canPlay = connected && !!track && !unresolved && track.support !== 'unsupported' && track.support !== 'failed'
  function activate() {
    if (!canPlay) return
    if (row.entry) { if (isCurrent) void player.toggle(); else { player.queue.start(row.id); void player.play(row.id) } }
    else addTracks([track!.id], true)
  }
  return <div ref={reorderable ? drop.ref : undefined} role="row" aria-rowindex={index + 2} aria-selected={selected} tabIndex={0}
    className={`track-row ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''} ${isCurrent ? 'current' : ''} ${drag.isDragSource ? 'dragging' : ''} ${drop.isDropTarget ? 'drop-target' : ''}`}
    onClick={event => onSelect(event, index)} onDoubleClick={activate} onKeyDown={event => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter') { event.preventDefault(); activate() }
      if (event.key === ' ') { event.preventDefault(); onSelect(event, index) }
    }}>
    <div role="gridcell" className="row-leading">
      {reorderable && <button ref={drag.ref} className="drag-handle" aria-label={`Reorder ${title}`} disabled={busy} onClick={event => event.stopPropagation()}><GripVertical size={15} /></button>}
      <label className="selection-checkbox" onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${title}`} checked={selected} disabled={!selectable || busy} onClick={event => { event.stopPropagation(); onSelect(event, index) }} onChange={() => {}} /></label>
      <span className={`row-number ${isCurrent ? 'active' : ''}`}>{isCurrent && playing ? <span className="equalizer"><i /><i /><i /></span> : index + 1}</span>
      <button className="row-play icon-button" disabled={!canPlay || busy} aria-label={row.entry ? `Play ${title}` : `Add and play ${title}`} onClick={event => { event.stopPropagation(); activate() }}>{isCurrent && playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
    </div>
    <div role="gridcell" className="track-title"><Artwork blob={track?.metadata.artwork} title={title} /><span><strong>{title}</strong><small>{unresolved ? row.entry?.issue : track?.metadata.artist || track?.filename}</small>{track && <small className="mobile-audio">{audioSummary(track)}</small>}</span></div>
    <div role="gridcell" className="track-album" title={track?.path}>{track?.metadata.album || (track?.path.includes('/') ? track.path.slice(0, track.path.lastIndexOf('/')) : '—')}</div>
    <div role="gridcell" className="track-format">{track ? <AudioSummary track={track} open={() => onDetails(track)} /> : '—'}</div>
    <div role="gridcell" className="track-time">{time(track?.metadata.duration)}</div>
    <div role="gridcell" className="track-action">
      {track && <button className="icon-button mobile-track-info" aria-label={row.entry ? `Audio details for ${title}` : `Actions for ${title}`} onClick={event => { event.stopPropagation(); if (row.entry) onDetails(track); else setActions(true) }}><Music2 size={18} /></button>}
      {unresolved && row.entry ? <button className="icon-button warning" aria-label={`Resolve ${title}`} onClick={event => { event.stopPropagation(); onResolve(row.entry!) }}><TriangleAlert size={17} /></button> : !row.entry && track ? <button className="icon-button" disabled={busy} aria-label={`Add ${title} to playlist`} onClick={event => { event.stopPropagation(); addTracks([track.id]) }}><Plus size={18} /></button> : null}
    </div>
    {actions && track && <Dialog title={title} close={() => setActions(false)}><div className="track-menu-actions"><button className="button secondary" disabled={busy} onClick={() => { addTracks([track.id]); setActions(false) }}>Add to playlist</button><button className="button primary" disabled={!canPlay || busy} onClick={() => { activate(); setActions(false) }}>Add &amp; Play</button><button className="button secondary" onClick={() => { setActions(false); onDetails(track) }}>Audio details</button></div></Dialog>}
  </div>
}
export function TrackList({ query, folder, artist, sortBy, playlist }: { query: string; folder: string; artist: string; sortBy: string; playlist: boolean }) {
  const library = useApp(s => s.libraries.find(l => l.id === s.activeLibrary))
  const session = library?.activePlaylist ? library.sessions[library.activePlaylist] : undefined
  const busy = useApp(s => s.busy) || session?.status === 'unverified'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resolve, setResolve] = useState<PlaylistEntry>()
  const [details, setDetails] = useState<Track>()
  const [selecting, setSelecting] = useState(false)
  const mobile = useMediaQuery('(max-width: 767px)')
  const [dragCount, setDragCount] = useState(0)
  const anchor = useRef(0), parent = useRef<HTMLDivElement>(null)
  const inventoryKey = JSON.stringify(Object.keys(library?.tracks ?? {}))
  const sourceRows = useMemo<RowData[]>(() => playlist ? session?.entries.map(entry => ({ id: entry.id, trackId: entry.trackId, entry })) ?? [] : Object.values(library?.tracks ?? {}).sort((a, b) => naturalCompare(a.path, b.path)).map(track => ({ id: track.id, trackId: track.id })), [playlist, session?.entries, inventoryKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    if (!query && !folder && !artist && sortBy === 'order') return sourceRows
    const getTrack = (row: RowData) => row.trackId ? library?.tracks[row.trackId] : undefined
    const filtered = sourceRows.filter(row => {
      const track = getTrack(row)
      const text = `${track?.metadata.title ?? row.entry?.raw} ${track?.metadata.artist ?? ''} ${track?.metadata.album ?? ''} ${track?.path ?? ''}`.toLowerCase()
      return text.includes(query.toLowerCase()) && (!folder || track?.path.startsWith(`${folder}/`)) && (!artist || track?.metadata.artist === artist)
    })
    if (sortBy !== 'order') filtered.sort((a, b) => naturalCompare(getTrack(a)?.metadata[sortBy as 'title' | 'artist' | 'album'] ?? '', getTrack(b)?.metadata[sortBy as 'title' | 'artist' | 'album'] ?? ''))
    return filtered
  }, [sourceRows, library?.tracks, query, folder, artist, sortBy])
  const reorderable = playlist && !query && !folder && !artist && sortBy === 'order'
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => mobile ? 72 : 64, overscan: 8, getItemKey: index => rows[index].id })
  useEffect(() => {
    const offset = parent.current?.scrollTop ?? 0
    virtual.measure()
    if (parent.current) parent.current.scrollTop = offset
  }, [mobile, virtual])
  const visible = virtual.getVirtualItems()
  const visibleIds = JSON.stringify(visible.map(item => rows[item.index].trackId).filter((id): id is string => !!id))
  useEffect(() => { if (library) prioritizeMetadata(library.id, JSON.parse(visibleIds) as string[]) }, [library?.id, visibleIds]) // eslint-disable-line react-hooks/exhaustive-deps
  const selectionKey = `${library?.id}/${playlist}/${session?.id}`
  useEffect(() => { setSelected(new Set()); anchor.current = 0 }, [selectionKey])
  const rowIds = useMemo(() => new Set(rows.map(row => row.id)), [rows])
  const validSelected = new Set([...selected].filter(id => rowIds.has(id)))
  function select(event: MouseEvent | KeyboardEvent, index: number) {
    if (busy) return
    const row = rows[index]
    if (event.shiftKey) {
      setSelected(new Set(rows.slice(Math.min(index, anchor.current), Math.max(index, anchor.current) + 1).map(r => r.id)))
    } else if (event.ctrlKey || event.metaKey || (mobile && selecting) || (event.target instanceof HTMLInputElement && event.target.type === 'checkbox')) {
      const next = new Set(validSelected); if (next.has(row.id)) next.delete(row.id); else next.add(row.id)
      setSelected(next); anchor.current = index
    } else { setSelected(new Set([row.id])); anchor.current = index }
  }
  function move(offset: number) {
    if (!session || !validSelected.size) return
    const indexes = session.entries.flatMap((entry, index) => validSelected.has(entry.id) ? [index] : [])
    reorderEntries(validSelected, offset < 0 ? Math.max(0, indexes[0] - 1) : Math.min(session.entries.length, indexes.at(-1)! + 2))
  }
  if (!library) return null
  return <section className="track-list" aria-label={playlist ? 'Playlist tracks' : 'Library tracks'}>
    <div className="selection-toolbar">
      <span>{validSelected.size ? `${validSelected.size} selected` : `${rows.length.toLocaleString()} ${query || folder || artist ? 'matching ' : ''}tracks`}</span>
      {mobile && <button className={`text-button toggle-button ${selecting ? 'active' : ''}`} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); if (selecting) setSelected(new Set()) }}>{selecting ? 'Done selecting' : 'Select tracks'}</button>}
      {validSelected.size > 0 && <div>{playlist ? <>
        <button className="text-button" disabled={!reorderable || busy} onClick={() => move(-1)}><ArrowUp size={15} />Move up</button><button className="text-button" disabled={!reorderable || busy} onClick={() => move(1)}><ArrowDown size={15} />Move down</button>
        <button className="text-button" disabled={busy} onClick={() => removeEntries(validSelected)}><Trash2 size={15} />Remove from playlist</button>
      </> : <button className="text-button" disabled={busy} onClick={() => addTracks([...validSelected])}><Plus size={15} />Add to playlist</button>}<button className="text-button" onClick={() => setSelected(new Set())}>Clear</button></div>}
      {playlist && !reorderable && <span className="muted">Clear filters and choose playlist order to reorder</span>}
    </div>
    <div role="grid" aria-label={playlist ? 'Playlist track list' : 'Library track list'} aria-rowcount={rows.length + 1} aria-colcount={6} onKeyDown={event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(new Set(rows.map(row => row.id))) }
      if (event.key === 'Escape') setSelected(new Set())
      if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && reorderable) { event.preventDefault(); move(event.key === 'ArrowUp' ? -1 : 1) }
      if (event.key === 'Delete' && playlist && !busy) removeEntries(validSelected)
      if (!event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && rows.length && event.target instanceof HTMLElement && event.target.getAttribute('role') === 'row') {
        event.preventDefault()
        const index = Number(event.target.getAttribute('aria-rowindex')) - 2
        const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
        select(event, next); virtual.scrollToIndex(next)
        requestAnimationFrame(() => parent.current?.querySelector<HTMLElement>(`[aria-rowindex="${next + 2}"]`)?.focus())
      }
    }}>
      <div className="track-header" role="row"><span role="columnheader">#</span><span role="columnheader">Title</span><span role="columnheader">Album / folder</span><span role="columnheader">Audio</span><span role="columnheader" aria-label="Duration"><Clock3 size={15} /></span><span role="columnheader" aria-label="Actions" /></div>
      <DragDropProvider onDragStart={event => { const id = String(event.operation.source?.id); if (!validSelected.has(id)) setSelected(new Set([id])); setDragCount(validSelected.has(id) ? validSelected.size : 1) }} onDragEnd={event => {
        setDragCount(0)
        if (event.canceled || !reorderable || !session) return
        const source = String(event.operation.source?.id), target = String(event.operation.target?.id)
        const from = session.entries.findIndex(entry => entry.id === source)
        const to = session.entries.findIndex(entry => entry.id === target)
        if (from < 0 || to < 0 || from === to) return
        reorderEntries(validSelected.has(source) ? validSelected : new Set([source]), to > from ? to + 1 : to)
      }}>
        <div className="track-scroll" ref={parent}><div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {visible.map(item => <div key={item.key} style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}><TrackRow row={rows[item.index]} index={item.index} selected={validSelected.has(rows[item.index].id)} selectable={!busy} reorderable={reorderable} selecting={selecting} onSelect={select} onResolve={setResolve} onDetails={setDetails} /></div>)}
        </div>{!rows.length && <div className="list-empty"><Music2 size={30} /><strong>{query ? 'No matching tracks' : playlist ? 'Make room for your favorites' : 'No audio files found'}</strong><span>{playlist ? 'Browse your library and add tracks to this playlist.' : 'Choose a folder with browser-native audio files.'}</span></div>}</div>
        <DragOverlay>{dragCount > 0 && <div className="drag-overlay"><GripVertical size={18} />Moving {dragCount} {dragCount === 1 ? 'track' : 'tracks'}</div>}</DragOverlay>
      </DragDropProvider>
    </div>
    <span className="sr-only" aria-live="polite">{validSelected.size} tracks selected{session ? `. Playlist revision ${session.revision}` : ''}</span>
    {resolve && <ResolveEntry entry={resolve} close={() => setResolve(undefined)} />}
    {details && <AudioDetails track={library.tracks[details.id] ?? details} close={() => setDetails(undefined)} />}
  </section>
}
export function AlbumCards({ tracks, choose }: { tracks: Track[]; choose: (album: string) => void }) {
  const albums = new Map<string, Track[]>()
  for (const track of tracks) {
    const album = track.metadata.album || (track.path.includes('/') ? track.path.slice(0, track.path.lastIndexOf('/')) : 'Loose tracks')
    const list = albums.get(album) ?? []; list.push(track); albums.set(album, list)
  }
  return <div className="album-grid">{[...albums].sort(([a], [b]) => naturalCompare(a, b)).map(([album, members]) => <button key={album} className="album-card" onClick={() => choose(album)}><Artwork blob={members.find(track => track.metadata.artwork)?.metadata.artwork} title={album} large /><strong>{album}</strong><span>{members[0].metadata.artist || 'Local collection'} · {members.length} tracks</span></button>)}</div>
}
