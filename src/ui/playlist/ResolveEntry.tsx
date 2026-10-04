import { useMemo, useState } from 'react'
import { mapEntry, useApp } from '../../app/store'
import type { PlaylistEntry } from '../../domain/models'
import { Dialog } from '../shared/Dialog'
export function ResolveEntry({ entry, close }: { entry: PlaylistEntry; close: () => void }) {
  const tracks = useApp(s => s.libraries.find(l => l.id === s.activeLibrary)?.tracks ?? {})
  const [search, setSearch] = useState(''), [selected, setSelected] = useState('')
  const options = useMemo(() => Object.values(tracks).filter(track => `${track.path} ${track.metadata.title}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(entry.suggestions?.includes(b.path)) - Number(entry.suggestions?.includes(a.path))), [tracks, search, entry.suggestions])
  return <Dialog title="Resolve a playlist reference" close={close}>
    <p className="dialog-intro"><strong>{entry.raw}</strong><br />{entry.issue} Choose the matching local file explicitly.</p>
    <label className="field">Find a local track<input value={search} onChange={event => setSearch(event.target.value)} autoFocus placeholder="Search filename or title" /></label>
    <label className="field">Matching tracks<select size={8} value={selected} onChange={event => setSelected(event.target.value)}>{options.slice(0, 200).map(track => <option key={track.id} value={track.id}>{entry.suggestions?.includes(track.path) ? 'Suggested: ' : ''}{track.path}</option>)}</select></label>
    {options.length > 200 && <p className="muted">Showing the first 200 matches. Refine your search.</p>}
    <div className="dialog-actions"><button className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={!selected} onClick={() => { mapEntry(entry.id, selected); close() }}>Use this track</button></div>
  </Dialog>
}
