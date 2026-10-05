import { useEffect, useState } from 'react'
import { ChevronDown, Download, FolderOpen, HardDrive, Globe2, ShieldCheck } from 'lucide-react'
import type { Capabilities } from '../../platform/capabilities/detect'
import { playbackSupport } from '../../platform/capabilities/detect'
import { usePlatformStatus } from '../../platform/capabilities/status'
import { sources, useApp } from '../../app/store'
import type { Access } from '../../platform/filesystem/types'
import { Dialog } from '../shared/Dialog'
import { BrowserRecommendation, isChromiumBrowser } from './BrowserSuggestion'

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
  const directSaving = c.userFileWriting && (!library || library.kind === 'direct')
  const recommendBrowser = !c.directoryPicker && !isChromiumBrowser()
  const rows: [string, Status, string][] = [
    ['Playlist file deletion', deletion, deletion === 'Not yet verified' ? 'Choose a direct-access library to verify support. Deletion requires separate confirmation and write permission.' : 'Deletes only an explicitly confirmed playlist file. Write permission is separate. Portable mode uses your file manager.'],
    ['Direct folder access', c.directoryPicker ? 'Available' : 'Unavailable', c.directoryPicker ? 'Select a folder to grant access. Permissions may need renewal.' : !c.secure ? 'Requires HTTPS or localhost. Portable selection still works.' : 'Use portable folder or file selection here.'],
    ['Portable folder selection', c.directoryInput ? 'Available' : 'Unavailable', c.directoryInput ? 'Reads selected subfolders. Your device picker may restrict folder selection; files need reselection after reload.' : 'Select multiple files instead.'],
    ['Multiple-file selection', 'Available', 'Choose local audio and playlist files. Folder paths may be unavailable.'],
    ['Original M3U8 write-back', c.userFileWriting ? 'Available' : 'Unavailable', c.userFileWriting ? 'Requires a direct-folder library and write permission when saving. Portable selections use Export.' : 'Export a download and place it at the indicated location in your library.'],
    ['Playlist export', 'Available', 'Requests an M3U8 download. The browser cannot verify its final location or completion.'],
    ['Draft and metadata storage', storage, outcomes.storageReason ?? (storage === 'Unavailable' ? 'This session works in memory. Save or export before closing.' : storage === 'Not yet verified' ? 'IndexedDB is present; opening and persistence have not been verified yet.' : 'Local browser storage is working. Quota limits or eviction can still require recovery.')],
    ['Remembered folder access', handles, outcomes.handleReason ?? (handles === 'Unavailable' ? 'Reselect files or folders after reopening. Draft recovery is separate from file access.' : handles === 'Not yet verified' ? 'The APIs are present; remembering a selected handle has not been verified yet.' : 'Remembered handles may need renewed permission. Music bytes are never cached.')],
    ['Native audio playback', 'Limited', 'Support depends on the codec, browser, and OS. The likelihoods below are hints; actual playback confirms compatibility.'],
    ['Live source bitrate', c.worker ? 'Available' : 'Unavailable', c.worker ? 'Local packet analysis for supported formats while the live readout is visible. No decoder or upload is required; unreadable variants show a reason.' : 'Static audio details remain available without workers.'],
    ['In-app volume', c.volumeControl ? 'Available' : 'Unavailable', c.volumeControl ? 'The audio element accepts volume changes. System volume remains separate.' : 'Use your device’s volume controls. Mute remains available.'],
    ['Media-key integration', c.mediaSession ? 'Available' : 'Unavailable', c.mediaSession ? 'Media Session is present; individual key and lock-screen behaviour varies.' : 'Use the player controls in the application.'],
  ]
  return <Dialog title="Your browser, your library" close={close} wide className="capability-dialog">
    <p className="dialog-intro">Your music stays local. Here’s what you can do in this browser.</p>
    <div className="capability-overview">
      <section><FolderOpen size={20} /><strong>Listen & create</strong><span className="capability-badge available">Available</span><p>Select music, play supported tracks and build playlists.</p></section>
      <section><Download size={20} /><strong>Save playlists</strong><span className={`capability-badge ${directSaving ? 'available' : 'limited'}`}>{directSaving ? 'Save & export' : 'Export only'}</span><p>{directSaving ? 'Save to your folder with permission, or download a copy.' : 'Download an M3U8, then place it in your music folder.'}</p></section>
      <section><HardDrive size={20} /><strong>Draft recovery</strong><span className={`capability-badge ${storage.toLowerCase().replaceAll(' ', '-')}`}>{storage}</span><p>{storage === 'Available' ? 'Drafts stay in this browser. Keep saved or exported copies.' : storage === 'Unavailable' ? 'Use this session and export before closing.' : storage === 'Limited' ? 'Storage is limited. Export a copy before closing.' : 'Local storage has not been verified yet.'}</p></section>
    </div>
    {outcomes.pickerReason && <p className="callout">Observed folder-access failure: {outcomes.pickerReason}. Portable selection and Export remain available.</p>}
    {library && <section className="capability-current"><strong>{library.name}</strong><p>{!library.connected || access?.reconnect ? 'Reconnect your library to use its files.' : library.kind === 'portable' ? 'Portable library · Reselect files after reopening.' : 'Direct-access library · Saving may ask for write permission.'}</p></section>}
    {recommendBrowser && <section className="browser-recommendation"><Globe2 size={18} /><div><BrowserRecommendation /></div></section>}
    {tour && <div className="help-guide"><span>Need a hand getting started?</span><button className="button secondary" onClick={tour}>Start tour</button></div>}
    <details className="capability-details"><summary>Technical details & permissions<ChevronDown size={16} /></summary>
    <p className="dialog-intro">Support and permission are separate. Browser features are checked without requesting access.</p>
    {library && <p className="capability-access">{library.kind === 'portable' ? `${library.connected ? 'Connected portable selection' : 'Reselection required'} · Export only` : `Read: ${access?.read ?? 'checking'} · Write: ${access?.write ?? 'checking'}${access?.reconnect || !library.connected ? ' · Reconnect required' : ''}`}</p>}
    <div className="capability-list">{rows.map(([name, status, description]) => <div className="capability-row" key={name}><span><strong>{name}</strong><small>{description}</small></span><span className={`capability-badge ${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span></div>)}</div>
    <div className="codec-hints">{['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'wma'].map(format => { const hint = playbackSupport(`file.${format}`); return <span key={format}><strong>{format.toUpperCase()}</strong> {hint === 'likely' ? 'Likely supported' : hint === 'unknown' ? 'May be supported' : 'Not advertised'}</span> })}</div>
    <p className="dialog-intro">Optional online lyrics sends the playing track’s title, artist, album and duration to LRCLIB after you allow lookup. Local LRC files and cached lyrics work offline.</p>
    </details>
    <p className="privacy-explanation"><ShieldCheck size={18} /><span><strong>No music uploads</strong> Music and artwork stay on your device. Online lyrics are optional.</span></p>
    <div className="dialog-actions"><button className="button primary" onClick={close}>Got it</button></div>
  </Dialog>
}
