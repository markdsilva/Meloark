import { useEffect } from 'react'
import type { Track } from '../../domain/models'
import { audioSummary, frequency, kbps } from '../../metadata/technical'
import { liveBitrate, useLiveBitrate } from '../../metadata/liveBitrate'
import { usePlayer } from '../../playback/player'
import { Dialog } from './Dialog'
import { elapsed } from './format'

export function LiveReadout({ track, enabled = true }: { track: Track; enabled?: boolean }) {
  const current = usePlayer(s => s.track?.id), playing = usePlayer(s => s.playing)
  const state = useLiveBitrate()
  const active = enabled && current === track.id
  useEffect(() => active ? liveBitrate.visible() : undefined, [active])
  if (!active) return null
  const text = state.sample ? `${state.sample.kind === 'constant' ? 'Constant' : playing ? 'Live' : 'Last live'} ${kbps(state.sample.bitrate)}`
    : state.status === 'unavailable' ? 'Live unavailable' : playing ? 'Analyzing…' : 'Play for live bitrate'
  return <span className="live-readout" title={state.reason ?? 'Encoded source bitrate over approximately one second. Not output-device or download bitrate.'}>{text}</span>
}
export function AudioFacts({ track }: { track: Track }) {
  const m = track.metadata
  const current = usePlayer(s => s.track?.id)
  const average = useLiveBitrate(s => s.sample?.average)
  const liveReason = useLiveBitrate(s => s.status === 'unavailable' ? s.reason : undefined)
  const facts = [
    ['Container', m.container ?? track.filename.split('.').at(-1)?.toUpperCase()],
    ['Codec', m.codec], ['Profile (reported)', m.codecProfile],
    [`Bitrate (${m.bitrateKind ?? 'reported'})`, kbps(m.bitrate)],
    ['Verified audio average', current === track.id && average ? kbps(average) : 'Not yet verified'],
    ['Sample rate', frequency(m.sampleRate)], ['Source bit depth', m.bitsPerSample ? `${m.bitsPerSample}-bit` : undefined],
    ['Channels', m.channels ? m.channels === 2 ? '2 · Stereo' : m.channels === 1 ? '1 · Mono' : String(m.channels) : undefined],
    ['Compression', m.lossless === true ? 'Lossless' : m.lossless === false ? 'Lossy' : undefined],
    ['Duration', m.duration ? elapsed(m.duration) : undefined], ['File size', `${(track.size / (1024 * 1024)).toFixed(2)} MiB`],
    ['Playback', track.support === 'likely' ? 'Likely supported; playback confirms compatibility' : track.support === 'unknown' ? 'May be supported' : 'Not supported or failed'],
    ['Filename', track.filename], ['Library-relative location', track.path],
  ]
  return <><LiveReadout track={track} /><dl className="audio-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Unavailable'}</dd></div>)}</dl>
    <p className="muted audio-note">Source information only. Your browser manages output-device format and resampling. Live values describe encoded packets over approximately one second. An average is verified after continuous packet coverage reaches the end, or immediately for validated PCM. Container and tag bytes are excluded.</p>
    {current === track.id && liveReason && <p className="callout" role="status">{liveReason}</p>}
    {m.error && <p className="callout">{m.error}</p>}</>
}
export function AudioDetails({ track, close }: { track: Track; close: () => void }) {
  return <Dialog title="Audio details" close={close}><p className="dialog-intro">{track.metadata.title}</p><AudioFacts track={track} /></Dialog>
}
export function AudioSummary({ track, open }: { track: Track; open: () => void }) {
  return <button className="audio-summary" aria-label={`Audio details for ${track.metadata.title}`} onClick={event => { event.stopPropagation(); open() }}>
    <span>{audioSummary(track)}</span><small>{track.support === 'unsupported' || track.support === 'failed' ? 'Playback unsupported' : track.metadata.bitrate ? `${kbps(track.metadata.bitrate)} ${track.metadata.bitrateKind ?? 'reported'}` : 'Source details'}</small>
  </button>
}
