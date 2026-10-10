import { useState } from 'react'
import { Pause, Play, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, LoaderCircle, ChevronUp, MoreHorizontal, MessageSquareText } from 'lucide-react'
import type { CSSProperties } from 'react'
import { usePlayer, player } from '../../playback/player'
import { togglePlayback, useApp } from '../../app/store'
import { Artwork } from '../shared/Artwork'
import { elapsed } from '../shared/format'
import { AudioDetails, AudioFacts, LiveReadout } from '../shared/AudioDetails'
import { audioSummary } from '../../metadata/technical'
import { useMediaQuery } from '../shared/useMediaQuery'
import { Dialog } from '../shared/Dialog'
import { detectCapabilities } from '../../platform/capabilities/detect'
import { toggleLyrics, useLyrics } from '../../lyrics/store'
import { AmbientBackground } from './AmbientBackground'

function Volume() {
  const volume = usePlayer(s => s.volume), muted = usePlayer(s => s.muted)
  const [capabilities] = useState(detectCapabilities)
  return <div className="volume"><button className={`icon-button toggle-button ${muted ? 'active' : ''}`} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} title={muted ? 'Unmute' : 'Mute'} onClick={() => player.mute()}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
    {capabilities.volumeControl ? <input className="player-range volume-range" style={{ '--range-fill': `${volume * 100}%` } as CSSProperties} aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => player.setVolume(Number(event.target.value))} /> : <small>Use your device’s volume controls</small>}</div>
}
export function Toggles() {
  const shuffle = usePlayer(s => s.shuffle), repeat = usePlayer(s => s.repeat)
  return <><button className={`icon-button toggle-button ${shuffle ? 'active' : ''}`} aria-label="Shuffle" aria-pressed={shuffle} title={`Shuffle ${shuffle ? 'on' : 'off'}`} onClick={() => player.shuffle()}><Shuffle size={20} /></button>
    <button className={`icon-button toggle-button ${repeat !== 'off' ? 'active' : ''}`} aria-label={`Repeat: ${repeat}`} aria-pressed={repeat !== 'off'} title={`Repeat ${repeat}`} onClick={() => player.repeat()}>{repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}</button></>
}
export function Transport({ previous = true }: { previous?: boolean }) {
  const current = usePlayer(s => s.current), playing = usePlayer(s => s.playing), loading = usePlayer(s => s.loading)
  const available = useApp(s => { const l = s.libraries.find(l => l.id === s.activeLibrary); return !!(l?.connected && (current || (s.view === 'playlist' ? l.activePlaylist && l.sessions[l.activePlaylist]?.entries.length : s.visibleTrackIds.length))) })
  return <>{previous && <button className="icon-button" aria-label="Previous track" disabled={!current} onClick={() => player.previous()}><SkipBack size={20} /></button>}
    <span className="transport-play-hint" tabIndex={!available ? 0 : undefined} data-tooltip={!available ? 'Reconnect your library, or add tracks to play this playlist. All tracks lets you listen without a playlist.' : undefined}><button className="play-button" aria-label={playing ? 'Pause' : 'Play'} disabled={!available} onClick={togglePlayback}>{loading ? <LoaderCircle className="spin" size={21} /> : playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button></span>
    <button className="icon-button" aria-label="Next track" disabled={!current} onClick={() => player.next()}><SkipForward size={20} /></button></>
}
export function Seek({ compact = false }: { compact?: boolean }) {
  const position = usePlayer(s => s.position), duration = usePlayer(s => s.duration)
  const fill = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0
  return <div className={`seek ${compact ? 'compact-seek' : ''}`}><span>{elapsed(position)}</span><input className="player-range" style={{ '--range-fill': `${fill}%` } as CSSProperties} aria-label="Seek" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} disabled={!duration} onChange={event => player.seek(Number(event.target.value))} /><span>{elapsed(duration)}</span></div>
}
function Identity() {
  const track = usePlayer(s => s.track), error = usePlayer(s => s.error), context = usePlayer(s => s.context)
  return <div className="now-playing"><Artwork blob={track?.metadata.artwork} title={track?.metadata.title ?? 'No track'} /><div><strong>{track?.metadata.title ?? 'Ready when you are'}</strong><span>{error ?? (track ? `${track.metadata.artist || track.filename} · ${context?.kind === 'library' ? 'Library queue' : context?.kind === 'search' ? 'Search queue' : 'Playlist queue'}` : 'Choose music and press Play')}</span></div></div>
}
export function Player() {
  const mobile = useMediaQuery('(max-width: 767px)'), narrow = useMediaQuery('(max-width: 1050px)')
  const track = usePlayer(s => s.track)
  const [expanded, setExpanded] = useState(false), [more, setMore] = useState(false), [details, setDetails] = useState(false)
  const [audioExpanded, setAudioExpanded] = useState(true)
  const lyricsOpen = useLyrics(s => s.open)
  const lyricsButton = <button className={`icon-button ghost-button toggle-button lyrics-toggle ${lyricsOpen ? 'active' : ''}`} aria-label="Lyrics" aria-pressed={lyricsOpen} aria-expanded={lyricsOpen} aria-controls="lyrics-panel" data-tooltip="Show synchronized lyrics" onClick={() => { setExpanded(false); setMore(false); toggleLyrics() }}><MessageSquareText size={18} strokeWidth={1.75} /></button>
  return <footer className={`player ${mobile ? 'player-mobile' : ''}`} aria-label="Music player">
    <AmbientBackground />
    <div className="player-identity"><Identity />{!mobile && track && <button className="player-audio" aria-label="Audio details" onClick={() => setDetails(true)}><span>{audioSummary(track)}</span><LiveReadout track={track} /></button>}</div>
    <div className="transport"><div className="transport-buttons">
      {mobile ? <><Transport previous={false} />{lyricsButton}<button className="icon-button" aria-label="Expand player" aria-expanded={expanded} onClick={() => setExpanded(true)}><ChevronUp size={20} /></button></> : <><Transport />{!narrow && <><Toggles /><Volume /></>}{narrow && <>{lyricsButton}<button className="icon-button" aria-label="More player controls" aria-expanded={more} onClick={() => setMore(true)}><MoreHorizontal size={21} /></button></>}</>}
    </div>{!mobile && <Seek />}</div>
    {mobile && <Seek compact />}
    {!mobile && !narrow && <div className="player-secondary">{lyricsButton}</div>}
    {expanded && mobile && <Dialog title="Now playing" className="now-playing-sheet" close={() => setExpanded(false)}>
      <AmbientBackground />
      <Artwork blob={track?.metadata.artwork} title={track?.metadata.title ?? 'No track'} large /><Identity /><Seek /><div className="sheet-controls"><Transport /><Toggles />{lyricsButton}</div><Volume />
      {track && <details className="sheet-audio" open={audioExpanded} onToggle={event => setAudioExpanded(event.currentTarget.open)}><summary>Audio details</summary>{audioExpanded && <AudioFacts track={track} />}</details>}
    </Dialog>}
    {more && !mobile && <Dialog title="Player controls" close={() => setMore(false)}><div className="sheet-controls"><Toggles /><Volume /></div>{track && <AudioFacts track={track} />}</Dialog>}
    {details && !mobile && track && <AudioDetails track={track} close={() => setDetails(false)} />}
  </footer>
}
