import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { create } from 'zustand'
import { AmbientBackground } from '../shell/AmbientBackground'
export const useDialogCount = create<{ count: number }>(() => ({ count: 0 }))
export function Dialog({ title, children, close, wide = false, className = '' }: { title: string; children: ReactNode; close: () => void; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const dialog = ref.current; dialog?.showModal()
    useDialogCount.setState(state => ({ count: state.count + 1 }))
    return () => {
      dialog?.close()
      useDialogCount.setState(state => ({ count: Math.max(0, state.count - 1) }))
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={ref} className={`dialog ${wide ? 'wide' : ''} ${className}`} aria-labelledby={id} onCancel={event => { event.preventDefault(); close() }} onKeyDown={event => event.stopPropagation()} onClick={event => {
    event.stopPropagation()
    if (event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
  }}>
    <AmbientBackground />
    <div className="dialog-heading"><h2 id={id}>{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></div>
    {children}
  </dialog>
}
