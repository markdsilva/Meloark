import { useEffect, useRef, useState } from 'react'
import { FolderOpen, HardDrive, LoaderCircle, ShieldCheck } from 'lucide-react'
import { exportPlaylist, reconnect, requestLibraryAccess, restoreWriteAccess, retryBrowserStorage, sources, useApp } from '../../app/store'
import { reportFileAccessError } from '../../platform/filesystem/accessEvents'
import { usePlayer } from '../../playback/player'
import { Dialog, useDialogCount } from '../shared/Dialog'

// Check only the libraries in use, on activation or return to the page. Queries
// never request permission; the recovery button supplies the required gesture.
export function AccessController() {
  const ready = useApp(state => state.ready), active = useApp(state => state.activeLibrary)
  const playing = usePlayer(state => state.context?.libraryId)
  useEffect(() => {
    if (!ready) return
    const checking = new Set<string>()
    let cancelled = false
    const check = async () => {
      if (document.visibilityState === 'hidden') return
      for (const id of new Set([active, playing])) {
        if (!id || checking.has(id)) continue
        const source = sources.get(id), library = useApp.getState().libraries.find(item => item.id === id)
        if (!source || source.kind !== 'direct' || !library?.connected) continue
        checking.add(id)
        try {
          const access = await source.getAccess()
          if (!cancelled && sources.get(id) === source && access.read !== 'granted') requestLibraryAccess(id)
        } catch (error) { if (!cancelled && sources.get(id) === source) reportFileAccessError(source, error, 'read') }
        finally { checking.delete(id) }
      }
    }
    void check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => { cancelled = true; window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [ready, active, playing])
  return null
}

export type RecoveryRequest = { libraryId: string } | { storage: true }
type RecoveryTarget = { libraryId: string; token: string; intent: 'read' | 'write' } | { storage: true; token: string }

export function AccessRecovery({ requested, handled, chooseFolder, chooseFiles }: {
  requested?: RecoveryRequest; handled: () => void; chooseFolder: (id: string) => void; chooseFiles: (id: string) => void
}) {
  const state = useApp(), playing = usePlayer(player => player.context?.libraryId), dialogs = useDialogCount(state => state.count)
  const [target, setTarget] = useState<RecoveryTarget>()
  const [working, setWorking] = useState(false), [error, setError] = useState('')
  const dismissed = useRef(new Set<string>())
  const close = () => { if (target) dismissed.current.add(target.token); setTarget(undefined); setError(''); handled() }
  useEffect(() => {
    if (target || dialogs || !state.ready || state.busy) return
    if (requested) {
      setError('')
      if ('storage' in requested) setTarget({ storage: true, token: `storage:${state.storageError}` })
      else {
        const issue = state.accessIssues[requested.libraryId]
        setTarget({ libraryId: requested.libraryId, intent: issue?.intent ?? 'read', token: `${requested.libraryId}:${issue?.revision ?? 'manual'}` })
      }
      return
    }
    const id = [state.activeLibrary, playing].find(id => id && state.accessIssues[id] && !dismissed.current.has(`${id}:${state.accessIssues[id].revision}`))
    if (id) {
      const issue = state.accessIssues[id]
      setError(''); setTarget({ libraryId: id, intent: issue.intent, token: `${id}:${issue.revision}` })
    }
  }, [state.ready, state.busy, state.activeLibrary, state.accessIssues, state.storageError, state.libraries.length, playing, dialogs, requested, target])
  useEffect(() => {
    if (!target || working) return
    if ('libraryId' in target) {
      const issue = state.accessIssues[target.libraryId]
      if (issue && issue.intent !== target.intent) {
        setTarget({ libraryId: target.libraryId, intent: issue.intent, token: `${target.libraryId}:${issue.revision}` })
        setError(''); return
      }
    }
    if ('storage' in target ? !state.storageError : !state.libraries.some(item => item.id === target.libraryId) ||
      !target.token.endsWith(':manual') && !state.accessIssues[target.libraryId]) {
      setTarget(undefined); setError(''); handled()
    }
  }, [target, working, state.storageError, state.accessIssues, state.libraries, handled])
  if (!target) return null
  const run = async (action: () => Promise<boolean>, failure: string) => {
    setWorking(true); setError('')
    try { if (await action()) close(); else setError(failure) }
    catch { setError(failure) }
    finally { setWorking(false) }
  }
  if ('storage' in target) return <Dialog title="Keep a copy of your playlist" close={close} className="access-recovery">
    <div className="recovery-symbol"><HardDrive size={25} aria-hidden="true" /></div>
    <p className="recovery-intro">Browser storage needs attention.</p><p>{state.storageError}</p>
    <p className="muted">Your music files stay on your device. Export a playlist copy before closing this tab. Browser settings, private browsing or a full disk can prevent drafts and folder access from being remembered.</p>
    {error && <p className="callout" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button secondary" onClick={close}>Not now</button>{state.libraries.find(item => item.id === state.activeLibrary)?.activePlaylist && <button className="button secondary" onClick={exportPlaylist}>Export playlist</button>}<button className="button primary" disabled={working} onClick={() => { void run(retryBrowserStorage, 'Storage is still unavailable. Export a copy and check your browser’s site storage settings.') }}>{working && <LoaderCircle className="spin" size={16} />}Retry storage</button></div>
  </Dialog>
  const library = state.libraries.find(item => item.id === target.libraryId)
  if (!library) return null
  const hasHandle = sources.get(library.id)?.kind === 'direct', write = target.intent === 'write'
  return <Dialog title={write ? 'Restore saving access' : hasHandle ? 'Restore folder access' : 'Reselect your music'} close={close} className="access-recovery">
    <div className="recovery-symbol">{hasHandle ? <ShieldCheck size={25} aria-hidden="true" /> : <FolderOpen size={25} aria-hidden="true" />}</div>
    <p className="recovery-intro">{library.name}</p>
    <p>{write ? 'Meloark can still read your music, but needs write permission to save playlists or sync filenames.' : hasHandle ? 'Your browser no longer allows Meloark to read this folder. Restore access to load tracks, album art and lyrics.' : 'Your playlist drafts are here. Select the same folder or files again to load tracks and album art.'}</p>
    <p className="muted">{write ? 'After granting access, use Save playlist or Retry sync to continue. Interrupted filename sync keeps its recovery data.' : 'Your playlist order and drafts are kept. Folder permission may need renewing after a restart or a change to site settings. Use Save playlist or Retry sync to resume pending file changes.'}</p>
    {error && <p className="callout" role="alert">{error}</p>}
    <div className="recovery-options">
      {hasHandle && <button className="button primary" disabled={working} onClick={() => { void run(() => write ? restoreWriteAccess(library.id) : reconnect(library.id), 'Access was not restored. Allow access in the browser prompt, or reselect the folder below.') }}>{working ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}{write ? 'Grant write access' : 'Grant access'}</button>}
      <button className={`button ${hasHandle ? 'secondary' : 'primary'}`} disabled={working} onClick={() => chooseFolder(library.id)}><FolderOpen size={17} />Reselect folder</button>
      {!write && <button className="button secondary" disabled={working} onClick={() => chooseFiles(library.id)}>Reselect files</button>}
    </div>
    <div className="dialog-actions"><button className="button secondary" onClick={close}>Not now</button></div>
  </Dialog>
}
