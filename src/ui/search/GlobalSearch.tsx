import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ChevronRight, Disc3, FolderOpen, ListMusic, LoaderCircle, Play, Search, UserRound, X } from 'lucide-react'
import { playSearchTrack, useApp } from '../../app/store'
import { SearchClient } from '../../search/client'
import { previewSearchPlaylist } from '../../search/playlistPreview'
import type { SearchKind, SearchResult, SearchResults, SearchScope } from '../../search/types'
import { prioritizeMetadata } from '../../metadata/scheduler'
import { Artwork } from '../shared/Artwork'
import { useMediaQuery } from '../shared/useMediaQuery'

const icons = { track: Play, album: Disc3, artist: UserRound, playlist: ListMusic, library: FolderOpen }
const labels: Record<SearchKind, string> = { track: 'Song', album: 'Album', artist: 'Artist', playlist: 'Playlist', library: 'Library' }
const empty: SearchResults = { items: [], total: 0 }
export function GlobalSearch() {
  const libraries = useApp(state => state.libraries)
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [scope, setScope] = useState<SearchScope>()
  const [results, setResults] = useState(empty), [pending, setPending] = useState(false), [error, setError] = useState<string>(), [previewing, setPreviewing] = useState(false)
  const [missing, setMissing] = useState(0), [active, setActive] = useState<string>()
  const [narrow, setNarrow] = useState(false), mobile = useMediaQuery('(max-width: 767px)'), compact = mobile || narrow
  const [position, setPosition] = useState<CSSProperties>()
  const root = useRef<HTMLDivElement>(null), form = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const client = useRef<SearchClient>(undefined), previewToken = useRef(0), id = useId()
  const items = [...results.items.filter(item => item.kind === 'track'), ...results.items.filter(item => item.kind !== 'track')]
  const activeIndex = Math.max(0, items.findIndex(item => item.key === active))
  const activeItem = items[activeIndex]
  function focusSearch() { setOpen(true); requestAnimationFrame(() => input.current?.focus()) }
  function close() { ++previewToken.current; setOpen(false); setPreviewing(false); if (compact) trigger.current?.focus(); else input.current?.blur() }
  useLayoutEffect(() => {
    const main = root.current?.closest('.main')
    if (!main) return
    const observer = new ResizeObserver(() => setNarrow(main.getBoundingClientRect().width <= 900))
    observer.observe(main)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const rect = form.current?.getBoundingClientRect()
      if (!rect) return
      const viewport = window.visualViewport, width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight, offset = viewport?.offsetTop ?? 0
      const popupWidth = Math.min(552, width - 24, compact ? rect.width : 552), top = rect.bottom + 10
      setPosition({ left: Math.max(12, Math.min(rect.left + rect.width / 2 - popupWidth / 2, width - popupWidth - 12)), top, width: popupWidth, maxHeight: Math.max(100, Math.min(560, height + offset - top - (compact ? 16 : 112))) })
    }
    place()
    const observer = new ResizeObserver(place)
    if (form.current) observer.observe(form.current)
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place) }
  }, [open, compact])
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); focusSearch() }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) { ++previewToken.current; setOpen(false); setPreviewing(false) }
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => () => { ++previewToken.current; client.current?.dispose(); client.current = undefined }, [])
  useEffect(() => {
    if (open) return
    // Keep a warm index for quick repeat searches, then release idle worker memory.
    const timer = setTimeout(() => { client.current?.dispose(); client.current = undefined }, 120_000)
    return () => clearTimeout(timer)
  }, [open])
  useEffect(() => {
    if (!open) return
    let valid = true
    const timer = setTimeout(() => {
      setPending(true)
      try {
        client.current ??= new SearchClient()
        void client.current.search(libraries, query, scope).then(next => {
          if (!valid) return
          setResults(next); setPending(false); setError(undefined)
        }).catch(reason => { if (valid) { setPending(false); setError(reason instanceof Error ? reason.message : 'Search is unavailable.'); client.current?.dispose(); client.current = undefined } })
      } catch { setPending(false); setError('Search could not start. Close it and try again.') }
    }, 70)
    return () => { valid = false; clearTimeout(timer) }
  }, [open, libraries, query, scope])
  const artworkIds = open ? JSON.stringify(results.items.flatMap(item => item.artworkTrackId ? [[item.libraryId, item.artworkTrackId]] : [])) : '[]'
  useEffect(() => {
    const groups = new Map<string, Set<string>>()
    for (const [libraryId, trackId] of JSON.parse(artworkIds) as [string, string][]) { if (!groups.has(libraryId)) groups.set(libraryId, new Set()); groups.get(libraryId)!.add(trackId) }
    for (const [libraryId, ids] of groups) prioritizeMetadata(libraryId, [...ids])
  }, [artworkIds])
  function changeQuery(value: string) { ++previewToken.current; setPreviewing(false); setQuery(value); setActive(undefined); setError(undefined); setResults(empty); setPending(true) }
  async function activate(item: SearchResult) {
    const library = useApp.getState().libraries.find(value => value.id === item.libraryId)
    if (!library) return
    if (item.kind === 'track') {
      const orderedIds = scope?.kind === 'playlist' ? scope.trackIds : items.filter(value => value.kind === 'track' && value.libraryId === item.libraryId).map(value => value.value)
      playSearchTrack(item.libraryId, item.value, orderedIds)
      return
    }
    const next: SearchScope = { kind: item.kind, libraryId: item.libraryId, title: item.title, value: item.value }
    const token = ++previewToken.current
    if (item.kind === 'playlist') {
      setPreviewing(true); setError(undefined)
      try {
        const preview = await previewSearchPlaylist(item.libraryId, item.value, (bytes, path, tracks) => {
          client.current ??= new SearchClient()
          return client.current.preview(bytes, path, tracks)
        })
        if (token !== previewToken.current) return
        next.trackIds = preview.trackIds; setMissing(preview.missing)
      } catch (reason) { if (token === previewToken.current) { setError(reason instanceof Error ? reason.message : 'Playlist could not be explored.'); setPreviewing(false) } return }
    } else setMissing(0)
    if (token !== previewToken.current) return
    setPreviewing(false); setScope(next); setQuery(''); setActive(undefined); setResults(empty); setPending(true); input.current?.focus()
  }
  function back() { ++previewToken.current; setPreviewing(false); setScope(undefined); setMissing(0); changeQuery(''); input.current?.focus() }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
      event.preventDefault()
      const next = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      setActive(items[next].key); panel.current?.querySelector(`#${CSS.escape(`${id}-option-${next}`)}`)?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter' && activeItem && !previewing) { event.preventDefault(); void activate(activeItem) }
    else if (event.key === 'Tab') { ++previewToken.current; setPreviewing(false); setOpen(false) }
  }
  const querying = pending || previewing
  return <div ref={root} className={`global-search ${open ? 'is-open' : ''} ${compact ? 'is-compact' : ''}`}>
    <button ref={trigger} className="icon-button global-search-trigger" aria-label="Search all music" aria-expanded={open} aria-controls={`${id}-panel`} data-tooltip="Search all your music (Ctrl/Cmd+K)" onClick={focusSearch}><Search size={19} /></button>
    <div ref={form} className="global-search-field">
      {compact && open ? <button className="icon-button" aria-label="Close search" onClick={close}><ArrowLeft size={19} /></button> : <Search size={17} aria-hidden="true" />}
      <input ref={input} role="combobox" aria-label="Search all music" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-results`} aria-activedescendant={open && activeItem ? `${id}-option-${activeIndex}` : undefined} placeholder="Search your music" autoComplete="off" spellCheck={false} value={query} maxLength={256} onFocus={() => setOpen(true)} onChange={event => changeQuery(event.target.value)} onKeyDown={keys} />
      <span className="global-search-trailing"><button className="icon-button" aria-label="Clear search" aria-hidden={!query} tabIndex={query ? 0 : -1} disabled={!query} onClick={() => { changeQuery(''); input.current?.focus() }}><X size={16} /></button>{!query && !compact && <kbd>Ctrl K</kbd>}</span>
    </div>
    {open && createPortal(<>
      {compact && <div className="global-search-backdrop" aria-hidden="true" />}
      <div ref={panel} id={`${id}-panel`} className={`global-search-panel ${compact ? 'compact' : ''}`} style={position}>
        <div className="global-search-heading">{scope ? <><button className="icon-button" aria-label="Search all libraries" onClick={back}><ArrowLeft size={17} /></button><div><strong>{scope.title}</strong><span>{labels[scope.kind]} · {libraries.find(library => library.id === scope.libraryId)?.name}</span></div></> : <><span className="global-search-emblem"><Search size={18} /></span><div><strong>Your music, everywhere</strong><span>{libraries.length ? `${libraries.length} ${libraries.length === 1 ? 'library' : 'libraries'} · songs, artists, albums & playlists` : 'Add a library to get started'}</span></div></>}{querying && <LoaderCircle className="spin" size={16} aria-label="Searching" />}</div>
        {error && <p className="global-search-error" role="alert">{error}</p>}
        <div className="global-search-results" id={`${id}-results`} role="listbox" aria-label="Music search results" aria-busy={querying}>
          {items.map((item, index) => {
            const library = libraries.find(value => value.id === item.libraryId), track = item.artworkTrackId ? library?.tracks[item.artworkTrackId] : undefined, Icon = icons[item.kind]
            const blocked = item.kind === 'track' && (!library?.connected || ['unsupported', 'failed'].includes(library.tracks[item.value]?.support ?? 'failed') || !!library.syncRecovery)
            return <div key={item.key}>
              {(index === 0 || item.kind !== 'track' && items[index - 1]?.kind === 'track') && <div className="global-search-group" aria-hidden="true">{item.kind === 'track' ? 'SONGS' : query ? 'COLLECTIONS' : 'EXPLORE YOUR LIBRARIES'}</div>}
              <div id={`${id}-option-${index}`} role="option" aria-selected={activeItem?.key === item.key} aria-disabled={blocked || undefined} className={`global-search-result ${activeItem?.key === item.key ? 'selected' : ''}`} onPointerMove={() => setActive(item.key)} onMouseDown={event => event.preventDefault()} onClick={() => { if (!previewing) void activate(item) }}>
                {item.kind === 'playlist' ? <span className="global-search-collection-art"><ListMusic size={21} /></span> : <Artwork blob={track?.metadata.artwork} title={item.title} />}
                <div className="global-search-result-copy"><strong>{item.title}</strong><span>{item.detail}</span><small>{item.kind === 'track' ? library?.name : `${labels[item.kind]}${item.count !== undefined ? ` · ${item.count.toLocaleString()} songs` : ''}`}{!library?.connected && ' · Reconnect to play'}{blocked && library?.connected && ' · Playback unavailable'}</small></div>
                <span className="global-search-result-action" aria-hidden="true">{item.kind === 'track' ? <Play size={15} fill="currentColor" /> : <Icon size={16} />}{item.kind !== 'track' && <ChevronRight size={13} />}</span>
              </div>
            </div>
          })}
        </div>
        {!items.length && !querying && !error && <div className="global-search-empty"><Search size={27} /><strong>{!libraries.length ? 'Your collection starts with a folder' : query ? `No matches for “${query}”` : scope ? 'No songs in this collection' : 'Find something you love'}</strong><p>{query ? 'Try a song, artist, album, playlist or filename.' : 'Your current playlist stays right where it is.'}</p></div>}
        {querying && !items.length && <div className="global-search-loading"><span className="global-search-skeleton" /><span className="global-search-skeleton" /><span className="global-search-skeleton" /></div>}
        <div className="global-search-footer"><span role="status">{querying ? 'Searching your collection…' : missing ? `${missing} unavailable playlist ${missing === 1 ? 'entry' : 'entries'}` : results.total > items.length ? `Showing ${items.length} of ${results.total.toLocaleString()} · refine your search` : query || scope ? `${results.total.toLocaleString()} ${results.total === 1 ? 'result' : 'results'}` : 'Explore without leaving your playlist'}</span><span className="global-search-key-hints"><kbd>↑</kbd><kbd>↓</kbd><span>navigate</span><kbd>↵</kbd><span>{activeItem?.kind === 'track' ? 'play' : 'explore'}</span><kbd>esc</kbd><span>close</span></span></div>
      </div>
    </>, document.body)}
  </div>
}
