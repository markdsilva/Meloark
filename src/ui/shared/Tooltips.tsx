import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Delegated hints cover virtualized controls as well as controls inside native dialogs.
export function Tooltips() {
  const [target, setTarget] = useState<HTMLElement>()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let focusTarget: HTMLElement | undefined
    const show = (event: Event) => {
      const element = (event.target as HTMLElement).closest<HTMLElement>('[data-tooltip], button[aria-label]')
      if (event.type === 'focusin') focusTarget = element ?? undefined
      // A stationary pointer can cross controls during responsive layout. It
      // must not replace the hint belonging to keyboard focus.
      if (event.type === 'pointerover' && focusTarget?.matches(':focus-visible') && document.activeElement === focusTarget) return
      clearTimeout(timer); setTarget(undefined)
      if (element) timer = setTimeout(() => setTarget(element), event.type === 'focusin' ? 100 : 500)
    }
    const hide = (event?: Event) => {
      if (event?.type === 'pointerout' && focusTarget?.matches(':focus-visible') && document.activeElement === focusTarget) return
      clearTimeout(timer); setTarget(undefined)
      if (event?.type === 'focusout') focusTarget = undefined
      // Focusing an offscreen control scrolls it into view. Show the focused
      // hint after that scroll, at its new position, rather than cancelling it.
      if (event?.type === 'scroll' && focusTarget && document.activeElement === focusTarget) {
        const element = focusTarget
        timer = setTimeout(() => setTarget(element), 100)
      }
    }
    document.addEventListener('pointerover', show); document.addEventListener('focusin', show)
    document.addEventListener('pointerout', hide); document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide); document.addEventListener('keydown', hide); document.addEventListener('scroll', hide, true)
    return () => {
      hide(); document.removeEventListener('pointerover', show); document.removeEventListener('focusin', show)
      document.removeEventListener('pointerout', hide); document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide); document.removeEventListener('keydown', hide); document.removeEventListener('scroll', hide, true)
    }
  }, [])
  if (!target?.isConnected) return null
  const rect = target.getBoundingClientRect()
  return createPortal(<div className="tooltip" role="tooltip" style={{ left: Math.max(8, Math.min(rect.left, innerWidth - 268)), top: rect.bottom + 8 > innerHeight - 65 ? Math.max(8, rect.top - 64) : rect.bottom + 8 }}>{target.dataset.tooltip ?? target.getAttribute('title') ?? target.getAttribute('aria-label')}</div>, target.closest('dialog') ?? document.body)
}
