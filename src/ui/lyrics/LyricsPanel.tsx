import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpToLine, Check, Download, FileText, LoaderCircle, MessageSquareText, MoreHorizontal, Music2, Radio, Search, Upload, X } from 'lucide-react'
import { useApp } from '../../app/store'
import { player, usePlayer } from '../../playback/player'
import { cueIndex, trackFingerprint } from '../../lyrics/lrc'
import { chooseLocalLyrics, chooseLyricsResult, closeLyrics, correctLyrics, downloadLyrics, findLyrics, importLyrics, loadCurrentLyrics, setLyricsOnline, suspendLyrics, useLyrics } from '../../lyrics/store'
import { Dialog } from '../shared/Dialog'
import { Artwork } from '../shared/Artwork'
import { elapsed } from '../shared/format'
import { Menu, menuAnchor, type MenuAnchor } from '../shared/Menu'
import { useMediaQuery } from '../shared/useMediaQuery'
import { Seek, Toggles, Transport } from '../shell/Player'
import type { LyricsRecord } from '../../lyrics/types'
import { AmbientBackground } from '../shell/AmbientBackground'

function useActiveCue(record?: LyricsRecord) {
  const playing = usePlayer(state => state.playing), position = usePlayer(state => state.position), current = usePlayer(state => state.current)
  const [active, setActive] = useState(-1)
  const last = useRef(-1), lastTime = useRef(0)
  const [jump, setJump] = useState(0)
  useEffect(() => {
    let frame = 0
    const observe = () => {
      const time = player.currentTime() * 1000
      if (Math.abs(time - lastTime.current) > 1500) setJump(value => value + 1)
      lastTime.current = time
      const index = record ? cueIndex(record.document.cues, time, record.correctionMs) : -1
      if (last.current !== index) { last.current = index; setActive(index) }
    }
    const tick = () => { observe(); if (playing && document.visibilityState !== 'hidden') frame = requestAnimationFrame(tick) }
    const visibility = () => { cancelAnimationFrame(frame); if (document.visibilityState !== 'hidden') { setJump(value => value + 1); tick() } }
    observe()
    if (playing && document.visibilityState !== 'hidden') frame = requestAnimationFrame(tick)
    document.addEventListener('visibilitychange', visibility)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility) }
  }, [record, playing, position, current])
  return { active, jump }
}

function SyncedLines({ record }: { record: LyricsRecord }) {
  const { active, jump } = useActiveCue(record), follow = useLyrics(state => state.follow)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const viewport = useRef<HTMLDivElement>(null), lines = useRef(new Map<number, HTMLButtonElement>())
  const previousJump = useRef(jump)
  const [measurement, setMeasurement] = useState(0)
  useEffect(() => {
    const container = viewport.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setMeasurement(value => value + 1))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!follow) return
    const row = lines.current.get(Math.max(0, active)), container = viewport.current
    if (!row || !container) return
    const immediate = reduced || jump !== previousJump.current
    previousJump.current = jump
    container.scrollTo({ top: row.offsetTop - container.offsetTop - container.clientHeight / 2 + row.clientHeight / 2, behavior: immediate ? 'instant' : 'smooth' })
  }, [active, follow, reduced, jump, measurement])
  const unfollow = () => useLyrics.setState({ follow: false })
  function focusLine(index: number) { lines.current.get(Math.max(0, Math.min(index, record.document.cues.length - 1)))?.focus() }
  return <div className="lyrics-reading">
    <div className="lyrics-scroll" ref={viewport} tabIndex={0} aria-label="Synchronized lyrics" onWheel={unfollow} onTouchMove={unfollow}
      role="region" onPointerDown={event => { if (event.target === event.currentTarget) unfollow() }}
      onKeyDown={event => { if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) unfollow() }}>
      <div className="lyrics-lines">{record.document.cues.map((cue, index) => <button key={`${cue.timeMs}:${index}`}
        ref={element => { if (element) lines.current.set(index, element); else lines.current.delete(index) }}
        className={`lyric-line ${active === index ? 'current' : index < active ? 'past' : ''}`}
        aria-current={active === index ? 'true' : undefined} tabIndex={index === Math.max(0, active) ? 0 : -1}
        aria-label={`Seek to ${elapsed(Math.max(0, cue.timeMs + record.correctionMs) / 1000)}: ${cue.text || 'Instrumental break'}`}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusLine(index + (event.key === 'ArrowDown' ? 1 : -1)) }
          if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); focusLine(event.key === 'Home' ? 0 : record.document.cues.length - 1) }
        }} onClick={() => { player.seek((cue.timeMs + record.correctionMs) / 1000); useLyrics.setState({ follow: true }) }}>
        {cue.text || <span className="lyric-break" aria-hidden="true">♪ ♪ ♪</span>}
      </button>)}</div>
    </div>
    {!follow && <button className="button secondary lyrics-follow" onClick={() => useLyrics.setState({ follow: true })}><Radio size={16} />Follow lyrics</button>}
  </div>
}

function SearchLyrics({ close }: { close: () => void }) {
  const track = usePlayer(state => state.track)
  const { results, searching, error, online, retryAt } = useLyrics()
  const [title, setTitle] = useState(track?.metadata.titleFromTag ? track.metadata.title : ''), [artist, setArtist] = useState(track?.metadata.artist ?? '')
  const limited = useRetryLimit(retryAt)
  return <Dialog title="Find another version" close={() => { suspendLyrics(); close() }} className="lyrics-search-dialog">
    <p className="dialog-intro">Choose the recording that matches your track. Searching sends this title and artist to LRCLIB; no music is uploaded.</p>
    <form onSubmit={event => { event.preventDefault(); void findLyrics(title, artist) }}>
      <label className="field">Song title<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={300} /></label>
      <label className="field">Artist<input value={artist} onChange={event => setArtist(event.target.value)} maxLength={300} /></label>
      {online !== 'enabled' && <button type="button" className="button secondary" onClick={() => setLyricsOnline('enabled')}>Allow LRCLIB lookup</button>}
      <button className="button primary" disabled={searching || online !== 'enabled' || !title.trim() || limited}>{searching ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}{searching ? 'Searching…' : 'Search lyrics'}</button>
    </form>
    {error && <p role="alert" className="callout">{error}</p>}
    <div className="lyrics-results" aria-live="polite">{results.map(result => <button key={result.id} className="lyrics-result" disabled={!result.instrumental && !result.syncedLyrics && !result.plainLyrics} onClick={() => { if (track) chooseLyricsResult(result, track.id); if (!useLyrics.getState().error) close() }}>
      <span><strong>{result.trackName}</strong><small>{result.artistName} · {result.albumName || 'Unknown album'}</small></span>
      <span><small>{Number.isFinite(result.duration) ? elapsed(result.duration) : 'Unknown duration'}</small><span className="lyrics-kind">{result.instrumental ? 'Instrumental' : result.syncedLyrics ? 'Synced' : result.plainLyrics ? 'Plain' : 'No lyrics'}</span></span>
    </button>)}</div>
    {!searching && !results.length && <p className="muted">Search by title and artist to find another recording.</p>}
  </Dialog>
}
function useRetryLimit(retryAt?: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!retryAt || retryAt <= Date.now()) return
    setNow(Date.now())
    const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time >= retryAt) clearInterval(timer) }, 1000)
    return () => clearInterval(timer)
  }, [retryAt])
  return !!retryAt && retryAt > now
}
function LyricsContent({ overlay }: { overlay: boolean }) {
  const state = useLyrics(), track = usePlayer(s => s.track)
  const [menu, setMenu] = useState<MenuAnchor>(), [search, setSearch] = useState(false), [timing, setTiming] = useState(false)
  const input = useRef<HTMLInputElement>(null), limited = useRetryLimit(state.retryAt)
  const record = state.record, document = record?.document
  return <>
    <div className="lyrics-identity"><Artwork blob={track?.metadata.artwork} title={track?.metadata.title ?? 'No track'} /><div><strong>{track?.metadata.title ?? 'Your music, line by line'}</strong><span>{track?.metadata.artist || (track ? track.filename : 'Play a track to see its lyrics')}</span></div><button className="icon-button ghost-button" aria-label="Lyrics options" aria-haspopup="menu" aria-expanded={!!menu} onClick={event => setMenu(menuAnchor(event.currentTarget))}><MoreHorizontal size={20} /></button></div>
    <input ref={input} className="sr-only" type="file" accept=".lrc" aria-label="Import lyrics file" disabled={!track} onChange={event => { const file = event.target.files?.[0]; if (file) void importLyrics(file); event.target.value = '' }} />
    {menu && <Menu anchor={menu} label="Lyrics options" close={() => setMenu(undefined)} items={[
      { label: 'Import LRC', run: () => input.current?.click(), disabled: !track, reason: 'Play a track first' },
      { label: 'Download LRC', run: downloadLyrics, disabled: document?.kind !== 'synced', reason: 'Synchronized lyrics are required' },
      { label: 'Find another version', run: () => setSearch(true), disabled: !track },
      { label: 'Adjust timing', run: () => setTiming(value => !value), disabled: document?.kind !== 'synced' },
      { label: 'Online lyrics', checked: state.online === 'enabled', run: () => setLyricsOnline(state.online === 'enabled' ? 'disabled' : 'enabled') },
    ]} />}
    {timing && record && document?.kind === 'synced' && <div className="lyrics-timing"><span>Timing <strong>{record.correctionMs > 0 ? '+' : ''}{(record.correctionMs / 1000).toFixed(1)}s</strong></span><button className="icon-button ghost-button" aria-label="Show lyrics 100 milliseconds earlier" onClick={() => correctLyrics(record.correctionMs - 100)}><ArrowUpToLine size={18} /></button><button className="icon-button ghost-button" aria-label="Show lyrics 100 milliseconds later" onClick={() => correctLyrics(record.correctionMs + 100)}><ArrowDownToLine size={18} /></button><button className="text-button" onClick={() => correctLyrics(0)}>Reset</button></div>}
    {state.error && <div className="lyrics-message" role="alert">{state.error}<button className="text-button" disabled={limited} onClick={() => { void loadCurrentLyrics(true) }}>{limited ? 'Please wait before retrying' : 'Retry'}</button></div>}
    {state.notice && <div className="lyrics-message" role="status">{state.notice}</div>}
    {state.cacheError && <div className="lyrics-message" role="status">{state.cacheError}</div>}
    {document?.kind === 'synced' && record ? <SyncedLines record={record} /> : document?.kind === 'plain' ? <div className="lyrics-plain"><span className="lyrics-kind">Plain lyrics · no timing available</span><p>{document.text}</p></div> : <div className="lyrics-empty">
      {state.status === 'loading' ? <LoaderCircle className="spin" size={30} /> : document?.kind === 'instrumental' ? <Music2 size={36} /> : <MessageSquareText size={36} />}
      <h3>{!track ? 'Make room for the words' : state.status === 'loading' ? 'Finding the words…' : document?.kind === 'instrumental' ? 'An instrumental moment' : state.status === 'local-choice' ? 'Choose your local lyrics' : state.status === 'not-found' ? 'No matching lyrics yet' : state.status === 'needs-metadata' ? 'Help us find this recording' : state.status === 'error' ? 'Lyrics are unavailable' : 'Your music, line by line'}</h3>
      <p>{!track ? 'Play a track from your library or playlist. Its lyrics will appear here.' : document?.kind === 'instrumental' ? 'This recording is marked as instrumental.' : state.status === 'local-choice' ? 'More than one track or lyrics file shares this name. Choose the file you want to use.' : state.status === 'needs-metadata' ? 'Automatic lookup needs a title, artist and duration. Search for your recording or import an LRC file.' : state.status === 'not-found' ? 'Try another recording or bring your own LRC file.' : state.status === 'loading' ? 'Playback keeps going while lyrics load.' : 'Use a local LRC file or find synchronized lyrics online.'}</p>
      {state.localPaths.map(path => <button className="button secondary local-lyrics-choice" key={path} onClick={() => { void chooseLocalLyrics(path) }}><FileText size={16} />{path}</button>)}
      {track && state.status !== 'loading' && document?.kind !== 'instrumental' && <div className="lyrics-empty-actions">
        {state.online === 'ask' ? <><p className="lyrics-consent">Online lookup sends title, artist, album and duration to LRCLIB. Your music stays on this device.</p><button className="button primary" onClick={() => setLyricsOnline('enabled')}><Search size={16} />Allow online lyrics</button><button className="text-button" onClick={() => setLyricsOnline('disabled')}>Use local lyrics only</button></> : <button className="button secondary" onClick={() => setSearch(true)}><Search size={16} />Find another version</button>}
        <button className="text-button" onClick={() => input.current?.click()}><Upload size={16} />Import LRC</button>
      </div>}
    </div>}
    <div className="lyrics-source">{document ? <><span>{document.kind === 'synced' && <Check size={12} />} {document.source.kind === 'lrclib' ? <a href={`https://lrclib.net/api/get/${document.source.providerId}`} target="_blank" rel="noreferrer">Lyrics from LRCLIB</a> : `Local lyrics · ${document.source.label}`}</span>{document.kind === 'synced' && <button className="icon-button ghost-button" aria-label="Download LRC" onClick={downloadLyrics}><Download size={16} /></button>}</> : <span>{state.online === 'enabled' ? 'Online lookup enabled · music stays local' : 'Local lyrics · no online lookup'}</span>}</div>
    {document?.warnings.length ? <p className="lyrics-warning">{document.warnings.join(' ')}</p> : null}
    {overlay && <div className="lyrics-mini-player"><Seek /><div className="sheet-controls"><Transport /><Toggles /></div></div>}
    {search && <SearchLyrics key={track?.id} close={() => setSearch(false)} />}
  </>
}
export function LyricsPanel() {
  const open = useLyrics(s => s.open), online = useLyrics(s => s.online)
  const track = usePlayer(s => s.track), libraryId = usePlayer(s => s.context?.libraryId), duration = usePlayer(s => s.duration)
  const connected = useApp(s => s.libraries.find(l => l.id === libraryId)?.connected)
  const generation = useApp(s => s.libraries.find(l => l.id === libraryId)?.generation)
  const docked = useMediaQuery('(min-width: 1200px)')
  const fingerprint = track ? trackFingerprint(track) : '', title = track?.metadata.title, titleFromTag = track?.metadata.titleFromTag, artist = track?.metadata.artist, album = track?.metadata.album
  const seconds = track?.metadata.duration || duration
  useEffect(() => {
    if (!open) return
    void loadCurrentLyrics()
    const visibility = () => { if (document.visibilityState === 'hidden') suspendLyrics(); else void loadCurrentLyrics() }
    document.addEventListener('visibilitychange', visibility)
    return () => { suspendLyrics(); document.removeEventListener('visibilitychange', visibility) }
  }, [open, online, track?.id, fingerprint, title, titleFromTag, artist, album, seconds, connected, generation])
  useEffect(() => {
    if (!open || !docked) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) closeLyrics() }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); if (opener?.isConnected) opener.focus() }
  }, [open, docked])
  if (!open) return null
  if (!docked) return <Dialog title="Lyrics" className="lyrics-drawer" close={closeLyrics}><AmbientBackground /><div id="lyrics-panel" className="lyrics-panel-content"><LyricsContent overlay /></div></Dialog>
  return <aside className="lyrics-panel" id="lyrics-panel" aria-label="Lyrics"><div className="lyrics-panel-heading"><span><MessageSquareText size={17} />LYRICS</span><button className="icon-button ghost-button" aria-label="Close lyrics" onClick={closeLyrics}><X size={18} /></button></div><LyricsContent overlay={false} /></aside>
}
