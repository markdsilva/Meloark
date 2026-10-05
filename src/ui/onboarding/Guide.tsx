import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Compass, X } from 'lucide-react'
import { useApp } from '../../app/store'
import { usePlayer } from '../../playback/player'

const preference = 'trackindex-guide-v1'
function remembered() { try { return !!localStorage.getItem(preference) } catch { return false } }
export const useGuide = create(() => ({ active: false, seen: remembered(), step: 0 }))
export function startGuide() {
  const state = useApp.getState(), library = state.libraries.find(item => item.id === state.activeLibrary)
  const session = library?.activePlaylist ? library.sessions[library.activePlaylist] : undefined
  useGuide.setState({ active: true, step: !library?.connected ? 0 : !usePlayer.getState().current ? 1 : !session ? 2 : !session.entries.length ? 3 : 4 })
}
function finish(status: 'skipped' | 'completed') {
  try { localStorage.setItem(preference, status) } catch { /* Remember for this session. */ }
  useGuide.setState({ active: false, seen: true })
}
const steps = [
  { title: 'Choose your music', text: 'Choose a folder or select files. Your music stays on this device. The picker opens only when you click.', target: 'folder' },
  { title: 'Try playing a track', text: 'Use a track’s Play button. Listening does not require a playlist and does not add tracks to one.', target: 'tracks' },
  { title: 'Create a playlist draft', text: 'Choose New playlist. Start empty or review the numbered filenames. Creating a draft does not change any file.', target: 'create' },
  { title: 'Add your favorites', text: 'Open All tracks and use + or the track menu to add music. Add & Play adds it and starts playback.', target: 'tabs' },
  { title: 'Make the order yours', text: 'In Playlist order, drag the handles or select tracks and use Move up/down. Undo restores playlist edits, never deleted files.', target: 'tracks' },
  { title: 'Save or export', text: 'Direct mode saves after permission and verification. Portable mode exports a download to place in your music folder. Edits stay in your draft until then.', target: 'save' },
]
export function Guide() {
  const { active, step } = useGuide()
  const state = useApp(), library = state.libraries.find(item => item.id === state.activeLibrary)
  const session = library?.activePlaylist ? library.sessions[library.activePlaylist] : undefined
  const current = usePlayer(s => s.current)
  const [host, setHost] = useState<HTMLElement>(document.body)
  const [position, setPosition] = useState<{ left: number; top: number }>()
  const revision = useRef<number | undefined>(undefined)
  useEffect(() => {
    revision.current = session?.revision
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return
    const advance = (step === 0 && library?.connected) || (step === 1 && current) || (step === 2 && session) ||
      (step === 3 && session?.entries.length) || (step === 4 && session && session.revision > (revision.current ?? session.revision))
    if (advance) useGuide.setState({ step: Math.min(5, step + 1) })
    if (step === 5 && (session?.status === 'download' || session?.status === 'saved' && session.baseline !== null)) finish('completed')
  }, [active, step, library?.connected, current, session])
  useEffect(() => {
    if (!active) return
    const update = () => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
      const mobileHost = innerWidth < 768 ? document.querySelector<HTMLElement>('.guide-mobile-host') : undefined
      setHost(dialog ?? mobileHost ?? document.body)
      const target = (dialog ?? document).querySelector<HTMLElement>(`[data-tour="${steps[step].target}"]`)
      const rect = target?.getBoundingClientRect()
      setPosition(rect && innerWidth >= 768 ? { left: Math.max(12, Math.min(rect.left, innerWidth - 332)), top: Math.max(12, Math.min(rect.bottom + 12, innerHeight - 240)) } : undefined)
    }
    update()
    const observer = new MutationObserver(records => { if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof HTMLElement && !node.closest('.guide-card')))) update() })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    window.addEventListener('resize', update); document.addEventListener('scroll', update, true)
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) finish('skipped') }
    window.addEventListener('keydown', keys)
    return () => { observer.disconnect(); window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); window.removeEventListener('keydown', keys) }
  }, [active, step])
  if (!active) return null
  return createPortal(<section className="guide-card" style={position} role="region" aria-label="Getting started guide"><div className="guide-heading"><small>GETTING STARTED · {step + 1} / {steps.length}</small><button className="icon-button ghost-button" aria-label="Skip tour" onClick={() => finish('skipped')}><X size={18} /></button></div><h3>{steps[step].title}</h3><p aria-live="polite">{steps[step].text}</p>{library && !library.connected && <p className="muted">Reconnect your library to continue.</p>}<div className="guide-actions"><button className="text-button" onClick={() => finish('skipped')}>Skip tour</button><button className="button secondary" onClick={() => step === 5 ? finish('completed') : useGuide.setState({ step: step + 1 })}>{step === 5 ? 'Finish' : 'Next tip'}</button></div></section>, host)
}
export function GuideInvitation() {
  const { active, seen } = useGuide(), ready = useApp(s => s.ready)
  if (active || seen || !ready) return null
  return <div className="guide-invitation" role="region" aria-label="Getting started"><Compass size={20} /><div><strong>New to Meloark?</strong><p>A short guide shows you how to listen and make a playlist.</p></div><button className="button secondary" onClick={startGuide}>Start tour</button><button className="text-button" onClick={() => finish('skipped')}>Skip</button></div>
}
