import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronRight, Disc3, Download, FileMusic, FolderOpen, HardDrive, Headphones, HelpCircle, LibraryBig, ListMusic, LoaderCircle, Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Undo2, Redo2, X } from 'lucide-react'
import { bootstrap, cancelScan, createNormalizedCopy, exportPlaylist, forgetLibrary, history, loadPlaylist, notify, openDirectory, openPortable, persistNow, reconnect, reconcileSource, savePlaylist, scanLibrary, selectLibrary, selectView, useApp } from '../../app/store'
import { isDirty, naturalCompare } from '../../domain/models'
import { detectCapabilities } from '../../platform/capabilities/detect'
import { EncodingError } from '../../playlists/codec'
import { player, usePlayer } from '../../playback/player'
import { prioritizeMetadata } from '../../metadata/scheduler'
import { Artwork } from '../shared/Artwork'
import { durationLabel } from '../shared/format'
import { CapabilityDialog } from '../onboarding/Capabilities'
import { CreatePlaylist } from '../playlist/CreatePlaylist'
import { AlbumCards, TrackList } from '../playlist/TrackList'
import { Player } from './Player'

export function App() {
  const state = useApp(), library = state.libraries.find(l => l.id === state.activeLibrary)
  const session = library?.activePlaylist ? library.sessions[library.activePlaylist] : undefined
  const [capabilities] = useState(detectCapabilities)
  const [help, setHelp] = useState(false), [create, setCreate] = useState(false), [sidebar, setSidebar] = useState(false)
  const [query, setQuery] = useState(''), [folder, setFolder] = useState(''), [artist, setArtist] = useState(''), [sort, setSort] = useState('order')
  const [filters, setFilters] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null), fileInput = useRef<HTMLInputElement>(null)
  const playerTrack = usePlayer(s => s.track)
  useEffect(() => { void bootstrap() }, [])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (useApp.getState().libraries.some(library => Object.values(library.sessions).some(isDirty))) { event.preventDefault(); event.returnValue = '' }
    }
    const visibility = () => { if (document.visibilityState === 'hidden') void persistNow() }
    window.addEventListener('beforeunload', unload); document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.closest('input, textarea, select, dialog') || event.target.isContentEditable)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(event.shiftKey ? 'redo' : 'undo') }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); history('redo') }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!session) return; if (capabilities.userFileWriting && library?.kind === 'direct') void savePlaylist(); else exportPlaylist() }
    }
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys)
  }, [session, library?.kind, capabilities.userFileWriting])
  useEffect(() => { setQuery(''); setFolder(''); setArtist(''); setSort('order') }, [library?.id, state.view])
  useEffect(() => { if (library && playerTrack) prioritizeMetadata(library.id, [playerTrack.id]) }, [library?.id, playerTrack?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const tracks = useMemo(() => Object.values(library?.tracks ?? {}), [library?.tracks])
  const folders = [...new Set(tracks.flatMap(track => track.path.includes('/') ? [track.path.slice(0, track.path.lastIndexOf('/'))] : []))].sort(naturalCompare)
  const artists = [...new Set(tracks.map(track => track.metadata.artist).filter(Boolean))].sort(naturalCompare)
  const playlistMode = state.view === 'playlist'
  const activeTracks = playlistMode ? (session?.entries.flatMap(entry => entry.trackId && library?.tracks[entry.trackId] ? [library.tracks[entry.trackId]] : []) ?? []) : tracks
  const totalDuration = activeTracks.reduce((total, track) => total + (track.metadata.duration ?? 0), 0)
  const savedStatus = session?.status === 'saving' ? 'Saving…' : session?.status === 'unverified' ? 'Save unverified' : session?.status === 'error' ? 'Needs attention' : session?.status === 'download' ? 'Download requested' : session && isDirty(session) ? 'Unsaved draft' : 'Saved to file'
  function portablePicker(id?: string, files = false) {
    const element = files ? fileInput.current : folderInput.current
    if (element) { element.dataset.reconnect = id ?? ''; element.value = ''; element.click() }
  }
  function chooseFolder(id?: string) { if (capabilities.directoryPicker) void openDirectory(id); else portablePicker(id, !capabilities.directoryInput) }
  async function choosePlaylist(path: string) {
    setSidebar(false)
    try { await loadPlaylist(path) }
    catch (error) {
      if (error instanceof EncodingError && /\.m3u$/i.test(path) && confirm('This legacy M3U is not valid UTF-8. Decode as Windows-1252 and preview its references?')) {
        await loadPlaylist(path, library?.id, 'windows-1252').catch(() => undefined)
      }
    }
  }
  return <div className="app">
    <input ref={element => { folderInput.current = element; if (element && capabilities.directoryInput) element.setAttribute('webkitdirectory', '') }} type="file" multiple className="sr-only" aria-label="Select library folder" onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) void openPortable(files, event.target.dataset.reconnect || undefined) }} />
    <input ref={fileInput} type="file" multiple className="sr-only" aria-label="Select library files" onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) void openPortable(files, event.target.dataset.reconnect || undefined) }} />
    <aside className={`sidebar ${sidebar ? 'open' : ''}`} aria-label="Library navigation">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); selectView('library') }}><span className="brand-mark"><ListMusic size={24} /></span><span>TrackIndex<small>YOUR MUSIC. YOUR ORDER.</small></span></a>
      <div className="nav-section"><span className="nav-heading">WORKSPACE</span>
        <button className={`nav-item ${state.view === 'library' ? 'active' : ''}`} onClick={() => { selectView('library'); setSidebar(false) }}><LibraryBig size={18} />All tracks<span>{tracks.length || ''}</span></button>
        <button className={`nav-item ${state.view === 'albums' ? 'active' : ''}`} onClick={() => { selectView('albums'); setSidebar(false) }}><Disc3 size={18} />Albums</button>
        <button className={`nav-item ${playlistMode ? 'active' : ''}`} disabled={!session} onClick={() => { selectView('playlist'); setSidebar(false) }}><ListMusic size={18} />Active playlist</button>
      </div>
      <div className="nav-section"><div className="nav-heading"><span>YOUR LIBRARIES</span><button className="icon-button" aria-label="Add library" onClick={() => chooseFolder()}><Plus size={16} /></button></div>
        {state.libraries.length ? state.libraries.map(item => <div className="library-nav" key={item.id}><button className={`nav-item ${library?.id === item.id ? 'current-library' : ''}`} onClick={() => { selectLibrary(item.id); setSidebar(false) }}><FolderOpen size={17} /><span className="library-name">{item.name}</span><i className={`connection-dot ${item.connected ? 'connected' : ''}`} title={item.connected ? 'Connected' : 'Reselection required'} /></button><button className="icon-button forget" aria-label={`Forget ${item.name}`} onClick={() => { if (confirm(`Forget “${item.name}” and its locally stored drafts? Music and playlist files will remain untouched.`)) void forgetLibrary(item.id) }}><X size={13} /></button></div>) : <p className="nav-empty">Your local collection<br />starts with a folder.</p>}
      </div>
      <div className="nav-section playlist-nav"><div className="nav-heading"><span>PLAYLISTS</span><button className="icon-button" disabled={!library || library.scanning || state.busy} aria-label="Create playlist" onClick={() => setCreate(true)}><Plus size={16} /></button></div>
        {library && [...new Set([...library.playlists, ...Object.keys(library.sessions)])].map(path => <button className={`nav-item ${playlistMode && library.activePlaylist === path ? 'active' : ''}`} key={path} title={path} onClick={() => { void choosePlaylist(path) }} disabled={!library.connected && !library.sessions[path]}><FileMusic size={16} /><span className="library-name">{library.sessions[path]?.name ?? path.split('/').at(-1)}</span>{library.sessions[path] && isDirty(library.sessions[path]) && <span className="draft-dot" title="Unsaved draft" />}</button>)}
        {!library?.playlists.length && !Object.keys(library?.sessions ?? {}).length && <p className="nav-empty">Your playlists will appear here.</p>}
      </div>
      <div className="sidebar-bottom"><div className="private-note"><ShieldCheck size={18} /><span>Private by design<small>Your music stays on your device.</small></span></div><button className="nav-item" onClick={() => setHelp(true)}><HelpCircle size={17} />Browser capabilities</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setSidebar(!sidebar)}><ListMusic size={20} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{library?.name ?? 'Welcome'}</strong></div><div className="topbar-end"><span className="privacy-pill"><ShieldCheck size={14} />100% local</span><button className="icon-button" aria-label="Browser capabilities" onClick={() => setHelp(true)}><HelpCircle size={19} /></button></div></header>
      {state.storageError && <div className="storage-banner" role="status">{state.storageError}</div>}
      {state.notice && <div className="notice" role="status"><span>{state.notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => notify(undefined)}><X size={16} /></button></div>}
      {!library ? <div className="welcome">
        <div className="welcome-copy"><span className="eyebrow"><Headphones size={15} />A HOME FOR YOUR LOCAL MUSIC</span><h1>A little order.<br /><span>A lot of music.</span></h1><p>Bring your collection together. Build playlists that feel right. Keep every track exactly where it belongs.</p><div className="welcome-actions"><button className="button primary" onClick={() => chooseFolder()}><FolderOpen size={18} />Choose a music folder<ArrowRight size={17} /></button><button className="text-button" onClick={() => portablePicker(undefined, true)}>Or select files</button></div>
          <p className="welcome-footnote"><ShieldCheck size={14} />No uploads. No account. Just your library.</p>
        </div>
        <div className="welcome-preview" aria-label="Example playlist preview"><div className="preview-caption">A PREVIEW OF YOUR WORKSPACE</div><div className="preview-hero"><Artwork title="Sunday slow" large /><div><span className="eyebrow">PLAYLIST</span><h2>Sunday slow</h2><p>A little space to breathe.</p></div></div><div className="preview-rule" />{[['First light', 'Morning sketches', '3:42'], ['Somewhere quiet', 'Open windows', '4:18'], ['Stay a little longer', 'Late afternoon', '2:56']].map(([title, artistName, length], index) => <div className="preview-track" key={title}><span>{index + 1}</span><Artwork title={title} /><div><strong>{title}</strong><small>{artistName}</small></div><span>{length}</span></div>)}<div className="preview-bottom"><ListMusic size={15} />Drag a track. Find your flow.</div></div>
        <div className="feature-grid"><div><FolderOpen /><h3>Your folders, connected</h3><p>Browse tracks across nested folders without moving or uploading a thing.</p></div><div><ListMusic /><h3>Make the order yours</h3><p>Reorder together, undo freely, and save only when you’re ready.</p></div><div><Download /><h3>Playlists that travel</h3><p>Read existing M3U playlists and create portable UTF-8 M3U8 files.</p></div></div>
        <div className="browser-note"><HardDrive size={18} /><div><strong>{capabilities.directoryPicker ? 'Direct folder access is available' : 'Portable mode is ready'}</strong><p>{capabilities.directoryPicker ? 'Choose a folder to begin. Write permission is requested only when you save.' : 'Select a folder or files, edit and play supported tracks, then download your playlist. Use a Chromium-based browser for direct write-back.'}</p></div><button className="text-button" onClick={() => setHelp(true)}>See capabilities<ArrowRight size={15} /></button></div>
      </div> : <div className="workspace">
        {!library.connected && <div className="reconnect-banner"><FolderOpen size={20} /><div><strong>Reconnect your music</strong><span>Your draft is here. File access needs to be restored before playback or saving.</span></div>{library.kind === 'direct' && <button className="button secondary" onClick={() => { void reconnect(library.id) }}>Grant access</button>}<button className="button primary" onClick={() => chooseFolder(library.id)}>Reselect folder</button><button className="button secondary" onClick={() => portablePicker(library.id, true)}>Reselect files</button></div>}
        <section className={`collection-hero ${playlistMode ? 'playlist-hero' : ''}`}><Artwork blob={activeTracks.find(track => track.metadata.artwork)?.metadata.artwork} title={playlistMode ? session?.name ?? 'Playlist' : library.name} large /><div><span className="eyebrow">{state.view === 'albums' ? 'YOUR COLLECTION' : playlistMode ? 'LOCAL PLAYLIST' : 'MUSIC LIBRARY'}</span><h1>{state.view === 'albums' ? 'Albums' : playlistMode ? session?.name.replace(/\.m3u8$/i, '') ?? 'Playlist' : library.name}</h1><p>{playlistMode ? 'Your favorites, in your order.' : 'Every track. Right where you left it.'}</p><div className="collection-meta"><span>{activeTracks.length.toLocaleString()} tracks</span><i />{durationLabel(totalDuration)}<i /><span>{library.kind === 'direct' ? 'Direct access' : 'Portable mode'}</span></div></div></section>
        <div className="workspace-actions"><div>
          {playlistMode && <button className="hero-play" aria-label="Play playlist" disabled={!session?.entries.length || !library.connected} onClick={() => { if (session?.entries[0]) { player.queue.start(session.entries[0].id); void player.play(session.entries[0].id) } }}><ArrowRight size={23} /></button>}
          <button className="button secondary" disabled={library.scanning || state.busy} onClick={() => setCreate(true)}><Plus size={17} />New playlist</button>
          {playlistMode && <><button className="icon-button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!session?.undo.length || state.busy || session.status === 'unverified'} onClick={() => history('undo')}><Undo2 size={19} /></button><button className="icon-button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!session?.redo.length || state.busy || session.status === 'unverified'} onClick={() => history('redo')}><Redo2 size={19} /></button></>}
          <button className="icon-button" aria-label="Refresh library" disabled={!library.connected || state.busy || library.scanning} onClick={() => { void scanLibrary(library.id) }}><RefreshCw size={17} /></button>
          <button className="icon-button" aria-label="Remember libraries" title="Request persistent browser storage" onClick={() => { void navigator.storage?.persist?.().then(granted => notify(granted ? 'Persistent browser storage was granted. Keep saving or exporting playlist copies.' : 'Persistence was not granted. Saving and exporting still work.')).catch(() => notify('Persistent storage is unavailable in this browser.')) }}><HardDrive size={18} /></button>
        </div><div>{session && playlistMode && <><span className={`save-status ${isDirty(session) ? 'unsaved' : ''}`}><i />{savedStatus}</span><button className="button secondary" disabled={state.busy} onClick={exportPlaylist}><Download size={16} />Export</button>{library.kind === 'direct' && capabilities.userFileWriting && <button className="button primary" disabled={!library.connected || state.busy || !isDirty(session) || !!session.document.issues.length || session.entries.some(entry => entry.issue)} onClick={() => { void savePlaylist() }}>{state.busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Save playlist</button>}</>}</div></div>
        {library.scanning && <div className="scan-status" role="status"><LoaderCircle className="spin" size={16} />Discovering your library… {tracks.length.toLocaleString()} tracks found<button className="text-button" onClick={() => cancelScan(library.id)}>Cancel</button></div>}
        {library.scanError && <div className="callout">{library.scanError}</div>}
        {session?.error && playlistMode && <div className="error-banner" role="alert"><span>{session.error}</span><button className="text-button" onClick={() => { void reconcileSource(library.id, session.id) }}>Reconcile</button><button className="text-button" disabled={!library.connected || session.baseline === null} onClick={() => { if (confirm('Reload the source and discard this playlist draft and history?')) void loadPlaylist(session.document.path, library.id, 'utf-8', true).catch(() => undefined) }}>Reload source</button></div>}
        {session && playlistMode && session.document.issues.length > 0 && <div className="error-banner" role="alert"><div>{session.document.issues.map(issue => <p key={issue}>{issue}</p>)}</div>{session.document.inspected && !session.document.issues.some(issue => issue.startsWith('HLS')) && <button className="button secondary" onClick={() => { const name = prompt('Create a reviewed copy without unknown directives. Original file remains unchanged. New filename:', 'Clean playlist.m3u8'); if (name) createNormalizedCopy(name) }}>Create normalized copy</button>}</div>}
        {state.view === 'albums' ? <AlbumCards tracks={tracks.filter(track => `${track.metadata.title} ${track.metadata.album}`.toLowerCase().includes(query.toLowerCase()))} choose={album => { selectView('library'); requestAnimationFrame(() => { setQuery(album); setFolder(folders.includes(album) ? album : '') }) }} /> : <>
          <div className="browse-toolbar"><div className="browse-tabs"><button className={!playlistMode ? 'active' : ''} onClick={() => selectView('library')}>All tracks</button><button className={playlistMode ? 'active' : ''} disabled={!session} onClick={() => selectView('playlist')}>Playlist</button></div><div className="browse-tools"><label className="search"><Search size={17} /><input aria-label="Search tracks" placeholder="Search in your collection" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label><button className={`icon-button ${filters ? 'active' : ''}`} aria-label="Track filters" aria-expanded={filters} onClick={() => setFilters(!filters)}><SlidersHorizontal size={18} /></button><label className="sort-label"><span className="sr-only">Sort tracks</span><select aria-label="Sort tracks" value={sort} onChange={event => setSort(event.target.value)}><option value="order">{playlistMode ? 'Playlist order' : 'Folder order'}</option><option value="title">Title</option><option value="artist">Artist</option><option value="album">Album</option></select></label></div></div>
          {filters && <div className="filter-bar"><label>Folder<select value={folder} onChange={event => setFolder(event.target.value)}><option value="">All folders</option>{folders.map(path => <option key={path}>{path}</option>)}</select></label><label>Artist<select value={artist} onChange={event => setArtist(event.target.value)}><option value="">All artists</option>{artists.map(name => <option key={name}>{name}</option>)}</select></label><button className="text-button" onClick={() => { setFolder(''); setArtist(''); setQuery('') }}>Clear filters</button></div>}
          <TrackList query={query} folder={folder} artist={artist} sortBy={sort} playlist={playlistMode} />
        </>}
        <div className="workspace-footnote"><ShieldCheck size={13} />Music files are never renamed or deleted.<span>{library.kind === 'portable' ? 'Reselect files after reopening · Export to update a playlist' : 'Changes stay in your draft until you save'}</span></div>
        {!session && tracks.length > 0 && <div className="getting-started"><ListMusic size={20} /><span><strong>Give your collection an order.</strong> Create a playlist or open one from the sidebar.</span><button className="text-button" onClick={() => setCreate(true)}>Create playlist<ArrowRight size={15} /></button></div>}
      </div>}
      {!state.ready && <div className="startup-status"><LoaderCircle className="spin" size={15} />Restoring workspace…</div>}
    </main>
    <Player />
    {help && <CapabilityDialog capabilities={capabilities} close={() => setHelp(false)} />}
    {create && library && <CreatePlaylist close={() => setCreate(false)} />}
  </div>
}
