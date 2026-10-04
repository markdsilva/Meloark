export function time(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return '—'
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}
export function elapsed(seconds: number) { return time(seconds) === '—' ? '0:00' : time(seconds) }
export function durationLabel(seconds: number) {
  if (!seconds) return 'Metadata loads as you browse'
  const minutes = Math.round(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`
}
