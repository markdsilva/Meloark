import { useEffect, useState } from 'react'
import { ChevronDown, Compass, Globe2, ShieldCheck } from 'lucide-react'
import type { Capabilities } from '../../platform/capabilities/detect'
import { playbackSupport } from '../../platform/capabilities/detect'
import { usePlatformStatus } from '../../platform/capabilities/status'
import { sources, useApp } from '../../app/store'
import type { Access } from '../../platform/filesystem/types'
import { Dialog } from '../shared/Dialog'
import { isChromiumBrowser } from './BrowserSuggestion'

type Status = 'Available' | 'Limited' | 'Unavailable' | 'Not yet verified'
export function CapabilityDialog({ capabilities: c, close, tour }: { capabilities: Capabilities; close: () => void; tour?: () => void }) {
  const library = useApp(s => s.libraries.find(l => l.id === s.activeLibrary))
  const outcomes = usePlatformStatus()
  const libraryId = library?.id
  const [access, setAccess] = useState<Access>()
  useEffect(() => {
    let current = true
    setAccess(undefined)
    const source = libraryId ? sources.get(libraryId) : undefined
    void source?.getAccess().then(value => { if (current) setAccess(value) }).catch(() => { if (current) setAccess({ read: 'denied', write: 'denied', reconnect: true }) })
    return () => { current = false }
  }, [libraryId, library?.connected])
  const storage: Status = !c.indexedDB || outcomes.storage === 'unavailable' ? 'Unavailable' : outcomes.storage === 'limited' ? 'Limited' : outcomes.storage === 'available' ? 'Available' : 'Not yet verified'
  const handles: Status = !c.handlePersistence ? 'Unavailable' : outcomes.handles === 'available' && storage === 'Available' ? 'Available' : outcomes.handles === 'limited' || storage === 'Unavailable' || storage === 'Limited' ? 'Limited' : 'Not yet verified'
  const source = library ? sources.get(library.id) : undefined
  const deletion: Status = !c.directoryPicker ? 'Unavailable' : library?.kind === 'portable' ? 'Limited' : source?.canDeletePlaylists === true ? 'Available' : source?.canDeletePlaylists === false ? 'Unavailable' : 'Not yet verified'
  const recommendBrowser = !c.directoryPicker && !isChromiumBrowser()
  const rows: [string, Status, string][] = [
    ['Automatic filename sync', !c.directoryPicker || library?.kind === 'portable' || !c.locks ? 'Unavailable' : library && Object.values(library.sessions).some(session => session.sync) ? 'Available' : 'Not yet verified', 'Requires write permission and a successful rename check. Updates wait until playback stops.'],
    ['Playlist file deletion', deletion, deletion === 'Not yet verified' ? 'Choose a direct-access folder to check support. Requires confirmation and write permission.' : 'Requires confirmation and write permission. In portable mode, use your file manager.'],
    ['Direct folder access', c.directoryPicker ? 'Available' : 'Unavailable', c.directoryPicker ? 'Select a folder to grant access. Permissions may need renewal.' : !c.secure ? 'Requires HTTPS or localhost. Portable selection still works.' : 'Use portable folder or file selection here.'],
    ['Portable folder selection', c.directoryInput ? 'Available' : 'Unavailable', c.directoryInput ? 'Includes subfolders. Reselect the folder after reopening.' : 'Select multiple files instead.'],
    ['Multiple-file selection', 'Available', 'Choose local audio and playlist files. Folder paths may be unavailable.'],
    ['Save playlists to a folder', !c.userFileWriting || library?.kind === 'portable' ? 'Unavailable' : access?.write === 'granted' ? 'Available' : 'Limited', c.userFileWriting ? 'Requires a direct-access library and write permission.' : 'Export an M3U8 and place it in your music folder.'],
    ['Playlist export', 'Available', 'Downloads an M3U8. Place it in your music folder.'],
    ['Draft and metadata storage', storage, outcomes.storageReason ?? (storage === 'Unavailable' ? 'This session works in memory. Save or export before closing.' : storage === 'Not yet verified' ? 'IndexedDB is present; opening and persistence have not been verified yet.' : 'Drafts are stored in this browser. Keep saved or exported copies.')],
    ['Remembered folder access', handles, outcomes.handleReason ?? (handles === 'Unavailable' ? 'Reselect files after reopening. Stored drafts remain separate.' : handles === 'Not yet verified' ? 'The APIs are present; remembering a selected handle has not been verified yet.' : 'Folder access may need renewed permission. Music files are not cached.')],
    ['Native audio playback', 'Limited', 'Format support varies by browser and device. Playback confirms compatibility.'],
    ['Live source bitrate', c.worker ? 'Available' : 'Unavailable', c.worker ? 'Shows source bitrate for supported formats during playback.' : 'Static audio details remain available without workers.'],
    ['In-app volume', c.volumeControl ? 'Available' : 'Unavailable', c.volumeControl ? 'The audio element accepts volume changes. System volume remains separate.' : 'Use your device’s volume controls. Mute remains available.'],
    ['Media-key integration', c.mediaSession ? 'Available' : 'Unavailable', c.mediaSession ? 'Media keys and lock-screen controls vary by device.' : 'Use the player controls in the application.'],
  ]
  const groups = [
    { title: 'Available', items: rows.filter(([, status]) => status === 'Available') },
    { title: 'Requires permission or verification', items: rows.filter(([, status]) => status === 'Limited' || status === 'Not yet verified') },
    { title: 'Unavailable', items: rows.filter(([, status]) => status === 'Unavailable') },
  ]
  return <Dialog title="Help & browser support" close={close} wide className="capability-dialog">
    <section className="browser-support-summary"><Globe2 size={22} /><div><strong>{c.directoryPicker ? 'Direct folder access supported' : 'Direct folder access unavailable'}</strong><p>{c.directoryPicker ? 'Play music, edit playlists, and save to a folder with write permission. Filename sync also requires a rename check.' : recommendBrowser ? 'Play music and export playlists here. Use desktop Chrome or Edge to save directly to a folder.' : 'Play music and export playlists here. Direct saving is unavailable in this session.'}</p></div></section>
    {outcomes.pickerReason && <p className="callout" role="status">Folder access failed: {outcomes.pickerReason}. Select files or use Export.</p>}
    {library && <section className="capability-current"><strong>{library.name}</strong><p>{!library.connected || access?.reconnect ? 'Reconnect this library to play or save.' : library.kind === 'portable' ? 'Portable library · Export only · Reselect files after reopening.' : 'Direct-access library · Saving may ask for write permission.'}</p></section>}
    {groups.filter(group => group.items.length).map(group => <section className="capability-group" key={group.title}><h3>{group.title}</h3><div className="capability-list">{group.items.map(([name, status, description]) => <div className="capability-row" key={name}><span><strong>{name}</strong><small>{description}</small></span><span className={`capability-badge ${status.toLowerCase().replaceAll(' ', '-')}`}>{status === 'Limited' ? 'Conditional' : status === 'Not yet verified' ? 'Not verified' : status}</span></div>)}</div></section>)}
    {tour && <section className="help-getting-started"><Compass size={22} /><div><h3>Getting started</h3><p>Follow a short tour to open music and arrange a playlist.</p></div><button className="button secondary" onClick={tour}>Start tour</button></section>}
    <details className="capability-details"><summary>Technical details & permissions<ChevronDown size={16} /></summary>
      <p className="dialog-intro">Browser support does not grant file access. Opening this panel requests no permissions.</p>
      {library && <p className="capability-access">{library.kind === 'portable' ? `${library.connected ? 'Connected portable selection' : 'Reselection required'} · Export only` : `Read: ${access?.read ?? 'checking'} · Write: ${access?.write ?? 'checking'}${access?.reconnect || !library.connected ? ' · Reconnect required' : ''}`}</p>}
      <div className="codec-hints">{['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'wma'].map(format => { const hint = playbackSupport(`file.${format}`); return <span key={format}><strong>{format.toUpperCase()}</strong> {hint === 'likely' ? 'Likely supported' : hint === 'unknown' ? 'May be supported' : 'Not advertised'}</span> })}</div>
      <p className="dialog-intro">Online lyrics sends the track’s title, artist, album and duration to LRCLIB only after you allow lookup. Local LRC files and cached lyrics work offline.</p>
      <p className="privacy-explanation"><ShieldCheck size={18} /><span><strong>No music uploads</strong> Music and artwork stay on your device.</span></p>
    </details>
    <div className="dialog-actions"><button className="button primary" onClick={close}>Got it</button></div>
  </Dialog>
}
