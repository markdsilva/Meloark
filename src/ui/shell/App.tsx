import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronRight, Disc3, Download, FileMusic, FolderOpen, HardDrive, Headphones, HelpCircle, LibraryBig, ListMusic, LoaderCircle, Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Undo2, Redo2, X } from 'lucide-react'
import { bootstrap, cancelScan, createNormalizedCopy, exportPlaylist, forgetLibrary, history, loadPlaylist, notify, openDirectory, openPortable, persistNow, reconnect, reconcileSource, savePlaylist, scanLibrary, selectLibrary, selectView, useApp } from '../../app/store'
import { isDirty, naturalCompare } from '../../domain/models'
import { detectCapabilities } from '../../platform/capabilities/detect'
import { EncodingError } from '../../playlists/codec'
import { usePlayer } from '../../playback/player'
import { prioritizeMetadata } from '../../metadata/scheduler'
import { Artwork } from '../shared/Artwork'
import { durationLabel } from '../shared/format'
import { CapabilityDialog } from '../onboarding/Capabilities'
import { BrowserSuggestion } from '../onboarding/BrowserSuggestion'
import { CreatePlaylist } from '../playlist/CreatePlaylist'
import { Player } from './Player'
import { Dialog } from '../shared/Dialog'
import { useMediaQuery } from '../shared/useMediaQuery'
import { ArrowDownWideNarrow, Play } from 'lucide-react'
import { playLibraryTrack, playPlaylistEntry } from '../../app/store'
import { ContextActions, Menu, menuAnchor, type MenuAnchor } from '../shared/Menu'
import { PlaylistNavigation } from '../playlist/PlaylistNavigation'
import { SyncControls } from '../playlist/SyncControls'
import { RemoveFilenameNumbers } from '../playlist/RemoveFilenameNumbers'
import { recoverSync } from '../../app/orderSync'
import { Guide, GuideInvitation, startGuide } from '../onboarding/Guide'
import { Tooltips } from '../shared/Tooltips'
import { BrowseTabs } from '../shared/BrowseTabs'
import { useLyrics } from '../../lyrics/store'
const LyricsPanel = lazy(() => import('../lyrics/LyricsPanel').then(module => ({ default: module.LyricsPanel })))
const TrackList = lazy(() => import('../playlist/TrackList').then(module => ({ default: module.TrackList })))
const AlbumCards = lazy(() => import('../playlist/TrackList').then(module => ({ default: module.AlbumCards })))

export function App() {
  const state = useApp(), library = state.libraries.find(l => l.id === state.activeLibrary)
  const session = library?.activePlaylist ? library.sessions[library.activePlaylist] : undefined
  const [capabilities] = useState(detectCapabilities)
  const [help, setHelp] = useState(false), [create, setCreate] = useState(false), [sidebar, setSidebar] = useState(false)
  const [query, setQuery] = useState(''), [folder, setFolder] = useState(''), [artist, setArtist] = useState(''), [sort, setSort] = useState('order')
  const [filters, setFilters] = useState(false)
  const [sortAnchor, setSortAnchor] = useState<MenuAnchor>()
  const mobile = useMediaQuery('(max-width: 767px)')
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('trackindex-sidebar') === 'collapsed' } catch { return false } })
  const [picker, setPicker] = useState(false)
  const [removeNumbers, setRemoveNumbers] = useState<{ libraryId: string; folder?: string }>()
  const lyricsOpen = useLyrics(s => s.open)
  useEffect(() => { if (!mobile) setSidebar(false) }, [mobile])
  function toggleCollapsed() { setCollapsed(value => { try { localStorage.setItem('trackindex-sidebar', value ? 'expanded' : 'collapsed') } catch { /* Session preference. */ } return !value }) }
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
      if (event.target instanceof HTMLElement && (event.target.closest('input, textarea, select, dialog, [role="menu"]') || event.target.isContentEditable)) return
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
  useEffect(() => { if (state.view === 'albums') useApp.setState({ visibleTrackIds: tracks.filter(track => `${track.metadata.title} ${track.metadata.album}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => naturalCompare(a.path, b.path)).map(track => track.id) }) }, [state.view, tracks, query])
  const totalDuration = activeTracks.reduce((total, track) => total + (track.metadata.duration ?? 0), 0)
  const savedStatus = session?.status === 'saving' ? 'Saving…' : session?.status === 'unverified' ? 'Save unverified' : session?.status === 'error' ? 'Needs attention' : session?.status === 'download' ? 'Download requested' : session && isDirty(session) ? 'Unsaved draft' : 'Saved to file'
  function portablePicker(id?: string, files = false) {
    const element = files ? fileInput.current : folderInput.current
    if (element) { element.dataset.reconnect = id ?? ''; element.value = ''; element.click() }
  }
  function chooseFolder(id?: string) { if (capabilities.directoryPicker) void openDirectory(id); else portablePicker(id, !capabilities.directoryInput) }
  async function choosePlaylist(path: string) {
    setSidebar(false); setPicker(false)
    try { return !!await loadPlaylist(path) }
    catch (error) {
      if (error instanceof EncodingError && /\.m3u$/i.test(path) && confirm('This legacy M3U is not valid UTF-8. Decode as Windows-1252 and preview its references?')) {
        return !!await loadPlaylist(path, library?.id, 'windows-1252').catch(() => false)
      }
      return false
    }
  }
  const navigation = (<aside className="sidebar" aria-label="Library navigation">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); selectView('library') }}><span className="brand-mark"><ListMusic size={24} /></span><span>Meloark<small>YOUR MUSIC. AT HOME.</small></span></a>
      <div className="nav-section"><span className="nav-heading">WORKSPACE</span>
        <button aria-label="All tracks" title="All tracks" aria-current={state.view === 'library' ? 'page' : undefined} className={`nav-item ${state.view === 'library' ? 'active' : ''}`} onClick={() => { selectView('library'); setSidebar(false); setPicker(false) }}><LibraryBig size={18} />All tracks<span>{tracks.length || ''}</span></button>
        <button aria-label="Albums" title="Albums" aria-current={state.view === 'albums' ? 'page' : undefined} className={`nav-item ${state.view === 'albums' ? 'active' : ''}`} onClick={() => { selectView('albums'); setSidebar(false); setPicker(false) }}><Disc3 size={18} />Albums</button>
        <button aria-label="Active playlist" title="Active playlist" aria-current={playlistMode ? 'page' : undefined} className={`nav-item ${playlistMode ? 'active' : ''}`} disabled={!session} onClick={() => { selectView('playlist'); setSidebar(false); setPicker(false) }}><ListMusic size={18} />Active playlist</button>
      </div>
      <div className="nav-section"><div className="nav-heading"><span>YOUR LIBRARIES</span><button className="icon-button" aria-label="Add library" onClick={() => chooseFolder()}><Plus size={16} /></button></div>
        {state.libraries.length ? state.libraries.map(item => <ContextActions key={item.id} label={`Actions for library ${item.name}`} className="library-nav" disabled={state.busy} items={[
          { label: 'Refresh library', run: () => { void scanLibrary(item.id) }, disabled: !item.connected || item.scanning || state.busy },
          { label: 'Reconnect library', run: () => { if (item.kind === 'direct') void reconnect(item.id); else chooseFolder(item.id) }, disabled: state.busy },
          ...(item.kind === 'direct' ? [{ label: 'Remove filename numbers…', run: () => { selectLibrary(item.id); setSidebar(false); setPicker(false); setRemoveNumbers({ libraryId: item.id }) }, disabled: !item.connected || item.scanning || !!item.scanError || !!item.syncRecovery || state.busy || !navigator.locks }] : []),
          { label: 'Remove library from app', run: () => { if (confirm(`Remove ${item.name} and its browser drafts? Music and playlist files stay untouched.`)) void forgetLibrary(item.id) }, disabled: state.busy, danger: true },
        ]}><button disabled={state.busy} aria-label={item.name} title={item.name} className={`nav-item ${library?.id === item.id ? 'current-library' : ''}`} onClick={() => { selectLibrary(item.id); setSidebar(false); setPicker(false) }}><FolderOpen size={17} /><span className="library-name">{item.name}</span><i className={`connection-dot ${item.connected ? 'connected' : ''}`} title={item.connected ? 'Connected' : 'Reselection required'} /></button><button className="icon-button ghost-button forget" disabled={state.busy} aria-label={`Forget ${item.name}`} data-tooltip={`Remove ${item.name} from the app; files stay untouched`} onClick={() => { if (confirm(`Forget ${item.name} and its locally stored drafts? Music and playlist files stay untouched.`)) void forgetLibrary(item.id) }}><X size={14} /></button></ContextActions>) : <p className="nav-empty">Your local collection<br />starts with a folder.</p>}
      </div>
      <div className="nav-section playlist-nav"><div className="nav-heading"><span>PLAYLISTS</span><button className="icon-button" disabled={!library || library.scanning || state.busy} aria-label="Create playlist" onClick={() => setCreate(true)}><Plus size={16} /></button></div>
        {library && <PlaylistNavigation library={library} open={choosePlaylist} />}
        {!library && <p className="nav-empty">Your playlists will appear here.</p>}
      </div>
      <div className="rail-actions"><button className="icon-button" aria-label="Libraries and playlists" title="Libraries and playlists" onClick={() => setPicker(true)}><FolderOpen size={20} /></button><button className="icon-button" aria-label="Add library" title="Add library" onClick={() => chooseFolder()}><Plus size={20} /></button><button className="icon-button" aria-label="Create playlist" title="Create playlist" disabled={!library || library.scanning || state.busy} onClick={() => setCreate(true)}><FileMusic size={20} /></button></div><div className="sidebar-bottom"><div className="private-note"><ShieldCheck size={18} /><span>Private by design<small>Your music stays on your device.</small></span></div><button className="nav-item" aria-label="Browser capabilities" title="Browser capabilities" onClick={() => { setSidebar(false); setPicker(false); setHelp(true) }}><HelpCircle size={17} />Browser capabilities</button></div>
    </aside>)
  return <div className={`app ${collapsed && !mobile ? 'collapsed' : ''} ${lyricsOpen ? 'lyrics-open' : ''}`}>
    <input ref={element => { folderInput.current = element; if (element && capabilities.directoryInput) element.setAttribute('webkitdirectory', '') }} type="file" multiple className="sr-only" aria-label="Select library folder" onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) void openPortable(files, event.target.dataset.reconnect || undefined) }} />
    <input ref={fileInput} type="file" multiple className="sr-only" aria-label="Select library files" onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) void openPortable(files, event.target.dataset.reconnect || undefined) }} />
    {!mobile && navigation}
    {mobile && sidebar && <Dialog title="Navigation" className="navigation-drawer" close={() => setSidebar(false)}>{navigation}</Dialog>}
    {picker && !mobile && <Dialog title="Libraries and playlists" className="navigation-picker" close={() => setPicker(false)}>{navigation}</Dialog>}
    <main className="main">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button ghost-button navigation-toggle" aria-label={mobile ? 'Toggle navigation' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={mobile ? sidebar : !collapsed} onClick={event => { event.currentTarget.focus(); if (mobile) setSidebar(!sidebar); else toggleCollapsed() }}>{collapsed && !mobile ? <ChevronRight size={20} /> : <ChevronRight className="collapse-chevron" size={20} />}</button><span>Workspace</span><ChevronRight size={14} /><strong>{library?.name ?? 'Welcome'}</strong></div><div className="topbar-end"><span className="privacy-pill"><ShieldCheck size={14} />Music stays local</span><a className="icon-button status-help" href="https://github.com/markdsilva/Meloark" target="_blank" rel="noopener noreferrer" aria-label="Meloark on GitHub (opens in a new tab)" data-tooltip="View Meloark on GitHub (opens in a new tab)"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56v-2.14c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.95.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18A11 11 0 0 1 12 6.07c.98 0 1.96.13 2.88.39 2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.08 0 4.42-2.68 5.39-5.24 5.68.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.79.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" /></svg></a><button className="icon-button status-help" aria-label="Browser capabilities" data-tooltip="Help, getting started and browser capabilities" onClick={() => setHelp(true)}><HelpCircle size={19} /></button></div></header>
      {state.storageError && <div className="storage-banner" role="status">{state.storageError}</div>}
      {state.notice && <div className="notice" role="status"><span>{state.notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => notify(undefined)}><X size={16} /></button></div>}
      <div className="guide-mobile-host" />
      {!library ? <div className="welcome">
        <div className="welcome-copy"><span className="eyebrow"><Headphones size={15} />A HOME FOR YOUR LOCAL MUSIC</span><h1>Your music.<br /><span>At home.</span></h1><p>Listen to your own music, explore your library, and build playlists that feel right. Your collection stays on your device.</p><div className="welcome-actions"><button className="button primary" data-tour="folder" onClick={() => chooseFolder()}><FolderOpen size={18} />Choose a music folder<ArrowRight size={17} /></button><button className="text-button" onClick={() => portablePicker(undefined, true)}>Or select files</button></div>
          <p className="welcome-footnote"><ShieldCheck size={14} />No uploads. No account. Just your library.</p><p className="welcome-meaning">Melody + ark — a home for your music.</p><GuideInvitation />
        </div>
        <div className="welcome-preview" aria-label="Example playlist preview"><div className="preview-caption">A PREVIEW OF YOUR WORKSPACE</div><div className="preview-hero"><Artwork title="Sunday slow" large /><div><span className="eyebrow">PLAYLIST</span><h2>Sunday slow</h2><p>A little space to breathe.</p></div></div><div className="preview-rule" />{[['First light', 'Morning sketches', '3:42'], ['Somewhere quiet', 'Open windows', '4:18'], ['Stay a little longer', 'Late afternoon', '2:56']].map(([title, artistName, length], index) => <div className="preview-track" key={title}><span>{index + 1}</span><Artwork title={title} /><div><strong>{title}</strong><small>{artistName}</small></div><span>{length}</span></div>)}<div className="preview-bottom"><ListMusic size={15} />Drag a track. Find your flow.</div></div>
        <div className="feature-grid"><div><FolderOpen /><h3>Your folders, connected</h3><p>Browse tracks across nested folders without moving or uploading a thing.</p></div><div><ListMusic /><h3>Make the order yours</h3><p>Reorder together, undo freely, and save only when you’re ready.</p></div><div><Download /><h3>Playlists that travel</h3><p>Read existing M3U playlists and create portable UTF-8 M3U8 files.</p></div></div>
        <div className="browser-note"><HardDrive size={18} /><div><strong>{capabilities.directoryPicker ? 'Direct folder access is available' : 'Portable mode is ready'}</strong><p>{capabilities.directoryPicker ? 'Choose a folder to begin. Write permission is requested when you Save or enable optional filename sync.' : 'Select a folder or files, edit and play supported tracks, then download your playlist. Use a Chromium-based browser for direct write-back.'}</p></div><button className="text-button" onClick={() => setHelp(true)}>See capabilities<ArrowRight size={15} /></button></div>
      </div> : <div className="workspace">
        {!library.connected && <div className="reconnect-banner"><FolderOpen size={20} /><div><strong>Reconnect your music</strong><span>Your draft is here. File access needs to be restored before playback or saving.</span></div>{library.kind === 'direct' && <button className="button secondary" onClick={() => { void reconnect(library.id) }}>Grant access</button>}<button className="button primary" onClick={() => chooseFolder(library.id)}>Reselect folder</button><button className="button secondary" onClick={() => portablePicker(library.id, true)}>Reselect files</button></div>}
        <section className={`collection-hero ${playlistMode ? 'playlist-hero' : ''}`}><Artwork blob={activeTracks.find(track => track.metadata.artwork)?.metadata.artwork} title={playlistMode ? session?.name ?? 'Playlist' : library.name} large /><div><span className="eyebrow">{state.view === 'albums' ? 'YOUR COLLECTION' : playlistMode ? 'LOCAL PLAYLIST' : 'MUSIC LIBRARY'}</span><h1>{state.view === 'albums' ? 'Albums' : playlistMode ? session?.name.replace(/\.m3u8$/i, '') ?? 'Playlist' : library.name}</h1><p>{playlistMode ? 'Your favorites, in your order.' : 'Every track. Right where you left it.'}</p><div className="collection-meta"><span>{activeTracks.length.toLocaleString()} tracks</span><i />{durationLabel(totalDuration)}<i /><span>{library.kind === 'direct' ? 'Direct access' : 'Portable mode'}</span></div></div></section>
        <div className="workspace-actions"><div>
          <span data-tooltip={playlistMode && !session?.entries.length ? 'Add tracks to play this playlist, or listen from All tracks' : undefined}><button className="hero-play" aria-label={playlistMode ? 'Play playlist' : 'Play library'} disabled={!library.connected || (playlistMode ? !session?.entries.length : !state.visibleTrackIds.length)} onClick={() => { if (playlistMode && session?.entries[0]) playPlaylistEntry(session.entries[0].id); else if (!playlistMode && state.visibleTrackIds[0]) playLibraryTrack(state.visibleTrackIds[0]) }}><Play size={23} fill="currentColor" /></button></span>
          <button className="button secondary" data-tour="create" disabled={library.scanning || state.busy} onClick={() => setCreate(true)}><Plus size={17} />New playlist</button>
          {playlistMode && <><button className="icon-button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!session?.undo.length || state.busy || session.status === 'unverified'} onClick={() => history('undo')}><Undo2 size={19} /></button><button className="icon-button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!session?.redo.length || state.busy || session.status === 'unverified'} onClick={() => history('redo')}><Redo2 size={19} /></button></>}
          <button className="icon-button" aria-label="Refresh library" disabled={!library.connected || state.busy || library.scanning} onClick={() => { void scanLibrary(library.id) }}><RefreshCw size={17} className={library.scanning ? 'spin' : ''} /></button>
          <button className="icon-button" aria-label="Remember libraries" title="Request persistent browser storage" onClick={() => { void navigator.storage?.persist?.().then(granted => notify(granted ? 'Persistent browser storage was granted. Keep saving or exporting playlist copies.' : 'Persistence was not granted. Saving and exporting still work.')).catch(() => notify('Persistent storage is unavailable in this browser.')) }}><HardDrive size={18} /></button>
        </div><div data-tour="save">{session && playlistMode && <>{session.sync ? <SyncControls removeNumbers={folder => setRemoveNumbers({ libraryId: library.id, folder })} /> : <span className={`save-status ${isDirty(session) ? 'unsaved' : ''}`}><i />{savedStatus}</span>}<button className="button secondary" disabled={state.busy || !!library.syncRecovery} onClick={exportPlaylist}><Download size={16} />Export</button>{!session.sync && library.kind === 'direct' && capabilities.userFileWriting && <button className="button primary" disabled={!library.connected || state.busy || !!library.syncRecovery || !isDirty(session) || !!session.document?.issues.length || session.entries.some(entry => entry.issue)} onClick={() => { void savePlaylist() }}>{state.busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Save playlist</button>}</>}</div></div>
        {library.scanning && <div className="scan-status" role="status"><LoaderCircle className="spin" size={16} />Discovering your library… {tracks.length.toLocaleString()} tracks found<button className="text-button" onClick={() => cancelScan(library.id)}>Cancel</button></div>}
        {library.scanError && <div className="callout">{library.scanError}</div>}
        {library.syncRecovery && <div className="error-banner" role="alert"><span>{library.syncRecovery}</span><button className="text-button" onClick={() => { void recoverSync(library.id) }}>Recover filename sync</button></div>}
        {session?.sync?.error && playlistMode && !library.syncRecovery && <p className="callout" role="status">{session.sync.error}</p>}
        {session?.error && !session.sync && playlistMode && <div className="error-banner" role="alert"><span>{session.error}</span><button className="text-button" onClick={() => { void reconcileSource(library.id, session.id) }}>Reconcile</button><button className="text-button" disabled={!library.connected || session.baseline === null || !session.document} onClick={() => { if (session.document && confirm('Reload the source and discard this playlist draft and history?')) void loadPlaylist(session.document.path, library.id, 'utf-8', true).catch(() => undefined) }}>Reload source</button></div>}
        {session?.document && playlistMode && session.document.issues.length > 0 && <div className="error-banner" role="alert"><div>{session.document.issues.map(issue => <p key={issue}>{issue}</p>)}</div>{session.document.inspected && !session.document.issues.some(issue => issue.startsWith('HLS')) && <button className="button secondary" onClick={() => { const name = prompt('Create a reviewed copy without unknown directives. Original file remains unchanged. New filename:', 'Clean playlist.m3u8'); if (name) createNormalizedCopy(name) }}>Create normalized copy</button>}</div>}
        {state.view === 'library' && tracks.length > 0 && <div className="getting-started"><ListMusic size={20} /><span><strong>{session ? session.entries.length ? 'Ready to arrange your songs?' : 'Add songs to your playlist' : 'Organize this folder'}</strong>{session ? session.entries.length ? 'Open your playlist to drag songs into order. All tracks is your library browser.' : 'Use + beside a song to add it. Then open the playlist to arrange your songs.' : 'Set up a playlist to drag songs into order and choose how to save it. You can listen here right away.'}</span><button className="text-button" disabled={library.scanning || state.busy || !!library.syncRecovery} onClick={() => { if (session) selectView('playlist'); else useApp.setState({ setupLibrary: library.id }) }}>{session ? session.entries.length ? 'Arrange playlist' : 'Open playlist' : 'Organize this folder'}<ArrowRight size={15} /></button></div>}
        {state.view === 'albums' ? <Suspense fallback={<p className="muted" role="status">Loading albums…</p>}><AlbumCards tracks={tracks.filter(track => `${track.metadata.title} ${track.metadata.album}`.toLowerCase().includes(query.toLowerCase()))} choose={album => { selectView('library'); requestAnimationFrame(() => { setQuery(album); setFolder(folders.includes(album) ? album : '') }) }} /></Suspense> : <>
          <div className="browse-toolbar"><BrowseTabs playlist={playlistMode} available={!!session} change={selectView} /><div className="browse-tools"><label className="search"><Search size={17} /><input aria-label="Search tracks" placeholder="Search in your collection" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button ghost-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label><button className={`icon-button ghost-button toggle-button ${filters ? 'active' : ''}`} aria-label="Track filters" aria-expanded={filters} onClick={() => setFilters(!filters)}><SlidersHorizontal size={20} /></button><button className="icon-button ghost-button" aria-label="Sort tracks" data-tooltip={`Sort: ${sort === 'order' ? playlistMode ? 'Playlist order' : 'Folder order' : sort}`} aria-haspopup="menu" aria-expanded={!!sortAnchor} onClick={event => setSortAnchor(menuAnchor(event.currentTarget))}><ArrowDownWideNarrow size={20} /></button></div></div>
          {sortAnchor && <Menu anchor={sortAnchor} label="Sort tracks" close={() => setSortAnchor(undefined)} items={['order', 'title', 'artist', 'album'].map(value => ({ label: value === 'order' ? playlistMode ? 'Playlist order' : 'Folder order' : value[0].toUpperCase() + value.slice(1), checked: sort === value, run: () => setSort(value) }))} />}
          {filters && <div className="filter-bar"><label>Folder<select value={folder} onChange={event => setFolder(event.target.value)}><option value="">All folders</option>{folders.map(path => <option key={path}>{path}</option>)}</select></label><label>Artist<select value={artist} onChange={event => setArtist(event.target.value)}><option value="">All artists</option>{artists.map(name => <option key={name}>{name}</option>)}</select></label><button className="text-button" onClick={() => { setFolder(''); setArtist(''); setQuery('') }}>Clear filters</button></div>}
          <div id="browse-panel" role="tabpanel" aria-labelledby={playlistMode ? 'tab-playlist' : 'tab-library'}><Suspense fallback={<p className="muted" role="status">Loading tracks…</p>}><TrackList query={query} folder={folder} artist={artist} sortBy={sort} playlist={playlistMode} /></Suspense></div>
        </>}
        <div className="workspace-footnote"><ShieldCheck size={13} />{session?.sync ? 'Filename sync is enabled · Audio files are never deleted.' : 'Playlist edits leave audio filenames unchanged.'}<span>{!playlistMode ? 'Arrange songs in the Playlist tab' : session?.sync ? 'Drag rows to sync folder order automatically' : library.kind === 'portable' ? 'Reselect files after reopening · Export to update a playlist' : 'Changes stay in your draft until you save'}</span></div>
      </div>}
      {!state.ready && <div className="startup-status"><LoaderCircle className="spin" size={15} />Restoring workspace…</div>}
    </main>
    {lyricsOpen && <Suspense fallback={null}><LyricsPanel /></Suspense>}
    <Player />
    <BrowserSuggestion capabilities={capabilities} paused={help || create || !!removeNumbers || !!state.setupLibrary || sidebar || picker || lyricsOpen} details={() => setHelp(true)} />
    <Guide />
    <Tooltips />
    {help && <CapabilityDialog capabilities={capabilities} close={() => setHelp(false)} tour={() => { setHelp(false); startGuide() }} />}
    {removeNumbers && <RemoveFilenameNumbers key={removeNumbers.libraryId} libraryId={removeNumbers.libraryId} initialFolder={removeNumbers.folder} close={() => setRemoveNumbers(undefined)} />}
    {(create || state.setupLibrary === library?.id && !!library) && library && <CreatePlaylist key={library.id} setup={state.setupLibrary === library.id} close={() => { setCreate(false); useApp.setState({ setupLibrary: undefined }) }} />}
  </div>
}
