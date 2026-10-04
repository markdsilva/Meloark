import { entrySignature, isDirty, type PlaylistEntry, type PlaylistSession } from './models'

export function moveEntries(entries: PlaylistEntry[], selected: ReadonlySet<string>, destination: number): PlaylistEntry[] {
  const position = Math.max(0, Math.min(entries.length, destination))
  const moving = entries.filter(entry => selected.has(entry.id))
  const remaining = entries.filter(entry => !selected.has(entry.id))
  const offset = entries.slice(0, position).filter(entry => selected.has(entry.id)).length
  const insertion = position - offset
  return [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)]
}
export function edit(session: PlaylistSession, after: PlaylistEntry[], label: string): PlaylistSession {
  if (session.status === 'saving' || session.status === 'unverified' || entrySignature(session.entries) === entrySignature(after)) return session
  const result: PlaylistSession = { ...session, entries: after, revision: session.revision + 1,
    undo: [...session.undo, { before: session.entries, after, label }].slice(-100), redo: [], error: undefined }
  result.status = isDirty(result) ? 'dirty' : 'saved'
  return result
}
export function travel(session: PlaylistSession, direction: 'undo' | 'redo'): PlaylistSession {
  if (session.status === 'saving' || session.status === 'unverified') return session
  const source = session[direction]
  const command = source.at(-1)
  if (!command) return session
  const result: PlaylistSession = { ...session, entries: direction === 'undo' ? command.before : command.after,
    revision: session.revision + 1, error: undefined,
    undo: direction === 'undo' ? source.slice(0, -1) : [...session.undo, command].slice(-100),
    redo: direction === 'redo' ? source.slice(0, -1) : [...session.redo, command] }
  result.status = isDirty(result) ? 'dirty' : 'saved'
  return result
}
