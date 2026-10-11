import type { LibrarySource } from './types'

export type AccessIntent = 'read' | 'write'
type Listener = (source: LibrarySource, intent: AccessIntent) => void
const listeners = new Set<Listener>()

// Autoplay restrictions and missing files are not folder permission failures.
// Call this only at file I/O boundaries, never for audio.play() rejections.
export function isFileAccessError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
}
export function onFileAccessLoss(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function reportFileAccessLoss(source: LibrarySource, intent: AccessIntent) {
  for (const listener of listeners) listener(source, intent)
}
export function reportFileAccessError(source: LibrarySource, error: unknown, intent: AccessIntent): boolean {
  if (!isFileAccessError(error)) return false
  reportFileAccessLoss(source, intent)
  return true
}
