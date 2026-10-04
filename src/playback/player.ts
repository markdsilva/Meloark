import { create } from 'zustand'
import type { Track } from '../domain/models'
import type { LibrarySource } from '../platform/filesystem/types'
import { PlaybackQueue, type Repeat, type QueueContext, type QueueItem } from './queue'
import { liveBitrate } from '../metadata/liveBitrate'

interface PlayerState {
  current: string | null; track?: Track; playing: boolean; loading: boolean; position: number; duration: number
  volume: number; muted: boolean; shuffle: boolean; repeat: Repeat; error?: string
  context?: QueueContext
}
function preferredVolume() {
  try { const value = Number(localStorage.getItem('trackindex-volume') ?? 0.75); return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.75 } catch { return 0.75 }
}
export const usePlayer = create<PlayerState>(() => ({ current: null, playing: false, loading: false, position: 0, duration: 0, volume: preferredVolume(), muted: false, shuffle: false, repeat: 'off' }))
class PlayerController {
  private audio?: HTMLAudioElement
  private url?: string
  private generation = 0
  private tracks: Record<string, Track> = {}
  private source?: LibrarySource
  private scope = ''
  readonly queue = new PlaybackQueue()
  private element() {
    if (this.audio) return this.audio
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.volume = usePlayer.getState().volume
    audio.addEventListener('timeupdate', () => { usePlayer.setState({ position: audio.currentTime }); liveBitrate.observe(audio.currentTime, !audio.paused) })
    audio.addEventListener('seeking', () => liveBitrate.seek(audio.currentTime))
    audio.addEventListener('durationchange', () => usePlayer.setState({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 }))
    audio.addEventListener('play', () => { usePlayer.setState({ playing: true }); liveBitrate.observe(audio.currentTime, true) })
    audio.addEventListener('pause', () => { usePlayer.setState({ playing: false }); liveBitrate.observe(audio.currentTime, false) })
    audio.addEventListener('ended', () => this.next(true))
    audio.addEventListener('error', () => {
      if (this.queue.current) this.queue.unavailable.add(this.queue.current)
      usePlayer.setState({ error: 'This track could not be decoded. Trying the next playable track.', loading: false })
      this.next(true)
    })
    this.audio = audio
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => { void this.toggle(true) })
      navigator.mediaSession.setActionHandler('pause', () => { void this.toggle(false) })
      navigator.mediaSession.setActionHandler('previoustrack', () => this.previous())
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next())
      navigator.mediaSession.setActionHandler('seekto', event => this.seek(event.seekTime ?? 0))
    }
    return audio
  }
  configure(context: QueueContext | undefined, entries: QueueItem[], tracks: Record<string, Track>, source?: LibrarySource) {
    const scope = context ? `${context.libraryId}/${context.kind === 'playlist' ? context.sessionId : '@browse'}` : ''
    if (scope !== this.scope) { this.stop(); this.queue.entries = []; this.queue.history = []; this.queue.future = []; this.scope = scope }
    usePlayer.setState({ context })
    this.tracks = tracks; this.source = source
    const before = this.queue.current
    const current = this.queue.reconcile(entries)
    if (before && current !== before) {
      if (current) void this.play(current, usePlayer.getState().playing)
      else this.stop()
    }
    const playingEntry = entries.find(entry => entry.id === current)
    const track = playingEntry?.trackId ? tracks[playingEntry.trackId] : undefined
    if (track && current === before) { usePlayer.setState({ track }); this.mediaMetadata(track) }
  }
  private mediaMetadata(track: Track) {
    if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') navigator.mediaSession.metadata = new MediaMetadata({ title: track.metadata.title, artist: track.metadata.artist, album: track.metadata.album })
  }
  async play(id: string, autoplay = true, attempts = 0): Promise<void> {
    const entry = this.queue.entries.find(e => e.id === id)
    const track = entry?.trackId ? this.tracks[entry.trackId] : undefined
    if (!track || !this.source || track.support === 'unsupported' || track.support === 'failed') {
      this.queue.current = id; this.queue.unavailable.add(id)
      const next = attempts < this.queue.entries.length ? this.queue.next() : null
      if (next) return this.play(next, autoplay, attempts + 1)
      this.stop('No playable tracks are available. Reconnect the library or choose a supported audio file.')
      return
    }
    this.queue.current = id
    const token = ++this.generation
    const audio = this.element()
    audio.pause()
    liveBitrate.register()
    usePlayer.setState({ current: id, track, loading: true, position: 0, duration: 0, error: undefined })
    try {
      const file = await this.source.readFile(track.path)
      if (token !== this.generation) return
      if (this.url) URL.revokeObjectURL(this.url)
      this.url = URL.createObjectURL(file)
      audio.src = this.url
      liveBitrate.register(file, `${this.scope}/${track.path}/${file.size}/${file.lastModified}`)
      audio.load()
      this.mediaMetadata(track)
      if (autoplay) {
        try { await audio.play() }
        catch (error) {
          if (token !== this.generation) return
          if (error instanceof DOMException && error.name === 'NotSupportedError') { this.queue.unavailable.add(id); this.next() }
          else usePlayer.setState({ error: 'Playback needs a user action. Press Play to continue.', playing: false })
        }
      }
    } catch (error) {
      if (token !== this.generation) return
      this.queue.unavailable.add(id)
      usePlayer.setState({ error: error instanceof Error ? error.message : 'Track unavailable.' })
      const next = attempts < this.queue.entries.length ? this.queue.next() : null
      if (next) await this.play(next, autoplay, attempts + 1)
      else this.stop('No playable tracks are available.')
    } finally { if (token === this.generation) usePlayer.setState({ loading: false }) }
  }
  async toggle(force?: boolean) {
    const audio = this.element()
    const play = force ?? audio.paused
    if (!play) { audio.pause(); return }
    if (!this.queue.current) {
      const first = this.queue.entries[0]
      if (first) { this.queue.start(first.id); await this.play(first.id) }
      return
    }
    try { await audio.play(); usePlayer.setState({ error: undefined }) }
    catch { usePlayer.setState({ error: 'Playback could not start. Check browser audio support and library access.' }) }
  }
  next(natural = false) {
    const id = this.queue.next(natural)
    if (id) void this.play(id)
    else this.stop(this.queue.unavailable.size ? 'No more playable tracks are available.' : undefined)
  }
  previous() {
    if (this.audio && this.audio.currentTime > 3) { this.seek(0); return }
    const id = this.queue.previous()
    if (id) void this.play(id)
  }
  seek(seconds: number) { if (this.audio && Number.isFinite(this.audio.duration)) { this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration)); usePlayer.setState({ position: this.audio.currentTime }) } }
  setVolume(volume: number) {
    this.element().volume = volume; usePlayer.setState({ volume })
    try { localStorage.setItem('trackindex-volume', String(volume)) } catch { /* Session preference still works. */ }
  }
  mute() { const muted = !usePlayer.getState().muted; this.element().muted = muted; usePlayer.setState({ muted }) }
  shuffle() { const shuffle = !this.queue.shuffle; this.queue.setShuffle(shuffle); usePlayer.setState({ shuffle }) }
  repeat() { const modes: Repeat[] = ['off', 'all', 'one']; this.queue.repeat = modes[(modes.indexOf(this.queue.repeat) + 1) % 3]; usePlayer.setState({ repeat: this.queue.repeat }) }
  stop(error?: string) {
    ++this.generation
    liveBitrate.register()
    this.audio?.pause()
    this.audio?.removeAttribute('src')
    this.queue.current = null
    if (this.url) { URL.revokeObjectURL(this.url); this.url = undefined }
    usePlayer.setState({ current: null, track: undefined, playing: false, loading: false, position: 0, duration: 0, error })
  }
}
export const player = new PlayerController()
