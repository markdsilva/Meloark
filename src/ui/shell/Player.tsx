import { Pause, Play, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, LoaderCircle } from 'lucide-react'
import { usePlayer, player } from '../../playback/player'
import { useApp } from '../../app/store'
import { Artwork } from '../shared/Artwork'
import { elapsed } from '../shared/format'
export function Player() {
  const state = usePlayer()
  const queueAvailable = useApp(s => {
    const library = s.libraries.find(l => l.id === s.activeLibrary)
    return !!(library?.connected && library.activePlaylist && library.sessions[library.activePlaylist]?.entries.length)
  })
  return <footer className="player" aria-label="Music player">
    <div className="now-playing"><Artwork blob={state.track?.metadata.artwork} title={state.track?.metadata.title ?? 'No track'} />
      <div><strong>{state.track?.metadata.title ?? 'Ready when you are'}</strong><span>{state.error ?? state.track?.metadata.artist ?? 'Open a playlist to start listening'}</span></div>
    </div>
    <div className="transport">
      <div className="transport-buttons">
        <button className={`icon-button ${state.shuffle ? 'active' : ''}`} aria-label="Shuffle" aria-pressed={state.shuffle} onClick={() => player.shuffle()}><Shuffle size={17} /></button>
        <button className="icon-button" aria-label="Previous track" disabled={!state.current} onClick={() => player.previous()}><SkipBack size={19} fill="currentColor" /></button>
        <button className="play-button" aria-label={state.playing ? 'Pause' : 'Play'} disabled={!queueAvailable} onClick={() => { void player.toggle() }}>{state.loading ? <LoaderCircle className="spin" size={20} /> : state.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
        <button className="icon-button" aria-label="Next track" disabled={!state.current} onClick={() => player.next()}><SkipForward size={19} fill="currentColor" /></button>
        <button className={`icon-button ${state.repeat !== 'off' ? 'active' : ''}`} aria-label={`Repeat: ${state.repeat}`} onClick={() => player.repeat()}>{state.repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</button>
      </div>
      <div className="seek"><span>{elapsed(state.position)}</span><input aria-label="Seek" type="range" min="0" max={state.duration || 1} step="0.1" value={Math.min(state.position, state.duration || 1)} disabled={!state.duration} onChange={event => player.seek(Number(event.target.value))} /><span>{elapsed(state.duration)}</span></div>
    </div>
    <div className="volume"><span className="local-badge">LOCAL AUDIO</span><button className="icon-button" aria-label={state.muted ? 'Unmute' : 'Mute'} onClick={() => player.mute()}>{state.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={state.volume} onChange={event => player.setVolume(Number(event.target.value))} /></div>
  </footer>
}
