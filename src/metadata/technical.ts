import type { Track } from '../domain/models'

export const kbps = (value?: number) => value && Number.isFinite(value) ? `${Math.round(value / 1000).toLocaleString()} kb/s` : 'Unavailable'
export const frequency = (value?: number) => value ? `${Number((value / 1000).toFixed(3))} kHz` : 'Unavailable'
export function audioSummary(track: Track) {
  const m = track.metadata, format = track.filename.split('.').at(-1)?.toUpperCase() ?? 'Audio'
  return [format, m.bitsPerSample ? `${m.bitsPerSample}-bit` : undefined, m.sampleRate ? frequency(m.sampleRate) : undefined].filter(Boolean).join(' · ')
}
