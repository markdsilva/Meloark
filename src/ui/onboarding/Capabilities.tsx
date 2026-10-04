import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { Capabilities } from '../../platform/capabilities/detect'
import { playbackSupport } from '../../platform/capabilities/detect'
import { usePlatformStatus } from '../../platform/capabilities/status'
import { sources, useApp } from '../../app/store'
import type { Access } from '../../platform/filesystem/types'
import { Dialog } from '../shared/Dialog'

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
  return <Dialog title="Your browser, your library" close={close} wide>
    {tour && <div className="help-guide"><span>Learn how to listen and create a playlist.</span><button className="button secondary" onClick={tour}>Start tour</button></div>}
    <p className="dialog-intro">Support is detected on this browser. Available APIs do not mean permission has already been granted.</p>
    {outcomes.pickerReason && <p className="callout">Observed folder-access failure: {outcomes.pickerReason}. Portable selection and Export remain available.</p>}
    {library && <section className="capability-current"><strong>Current library: {library.name}</strong><p>{library.kind === 'portable' ? `${library.connected ? 'Connected portable selection' : 'Reselection required'} · Export only` : `Read: ${access?.read ?? 'checking'} · Write: ${access?.write ?? 'checking'}${access?.reconnect || !library.connected ? ' · Reconnect required' : ''}`}</p></section>}
    <div className="capability-list">{rows.map(([name, status, description]) => <div className="capability-row" key={name}><span><strong>{name}</strong><small>{description}</small></span><span className={`capability-badge ${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span></div>)}</div>
    <div className="codec-hints">{['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'wma'].map(format => { const hint = playbackSupport(`file.${format}`); return <span key={format}><strong>{format.toUpperCase()}</strong> {hint === 'likely' ? 'Likely supported' : hint === 'unknown' ? 'May be supported' : 'Not advertised'}</span> })}</div>
    <p className="privacy-explanation"><ShieldCheck size={18} /><span><strong>No music uploads</strong> Your music, tags, and artwork stay on this device.</span></p>
    {!c.directoryPicker && <p className="callout">Desktop Chromium browsers offer the complete folder and write-back experience. Continue using the compatible features here.</p>}
    <div className="dialog-actions"><button className="button primary" onClick={close}>Got it</button></div>
  </Dialog>
}
