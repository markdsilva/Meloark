import { dirname } from '../domain/models'

export function normalizeRelative(path: string): string | null {
  if (/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(path) || /[\0\r\n]/.test(path)) return null
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (!parts.length) return null; parts.pop() }
    else parts.push(part)
  }
  return parts.length ? parts.join('/') : null
}
export function resolveReference(raw: string, playlistPath: string, available: ReadonlySet<string>): { path?: string; issue?: string; suggestions?: string[] } {
  if (/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(raw)) return { issue: 'Absolute paths and URLs require a local track mapping.' }
  const base = dirname(playlistPath)
  const relative = (value: string) => normalizeRelative(base ? `${base}/${value}` : value)
  const literal = relative(raw)
  const windows = raw.includes('\\') ? relative(raw.replaceAll('\\', '/')) : literal
  const matches = [...new Set([literal, windows].filter((path): path is string => !!path && available.has(path)))]
  if (matches.length > 1) return { issue: 'Ambiguous path separators. Choose a local track.', suggestions: matches }
  if (matches.length === 1) return { path: matches[0] }
  if (!literal && !windows) return { issue: 'Reference escapes the library or contains invalid characters.' }
  const candidates = [...available].filter(path => [literal, windows].some(value => value && value.toLowerCase() === path.toLowerCase()))
  return { issue: candidates.length ? 'Filename case differs. Confirm a local track.' : 'Track was not found in this library.', suggestions: candidates }
}
export function relativeReference(trackPath: string, playlistPath: string): string {
  if (normalizeRelative(trackPath) !== trackPath || normalizeRelative(playlistPath) !== playlistPath) throw new Error('Invalid library-relative path.')
  const base = dirname(playlistPath).split('/').filter(Boolean)
  const target = trackPath.split('/')
  while (base.length && target.length && base[0] === target[0]) { base.shift(); target.shift() }
  let result = [...base.map(() => '..'), ...target].join('/')
  if (result.startsWith('#')) result = `./${result}`
  // A literal backslash filename cannot be exported unambiguously across platforms.
  if (result.includes('\\')) throw new Error('A filename contains a backslash and cannot be represented safely in a portable playlist.')
  return result
}
