import { useEffect, useRef, useState, type RefObject } from 'react'

const minimum = 220, maximum = 360, defaultWidth = 240
const preferenceKey = 'meloark-sidebar-width'

export function readSidebarWidth() {
  try {
    const value = Number(localStorage.getItem(preferenceKey))
    return Number.isFinite(value) && value >= minimum && value <= maximum ? value : defaultWidth
  } catch { return defaultWidth }
}

function limit() { return Math.min(maximum, Math.max(minimum, window.innerWidth - 480)) }
function bounded(width: number) { return Math.round(Math.max(minimum, Math.min(limit(), width))) }

interface Drag {
  root: HTMLDivElement
  handle: HTMLDivElement
  pointer: number
  startX: number
  startWidth: number
  preference: number
  next: number
  frame?: number
}

export function SidebarResize({ root, width, change }: { root: RefObject<HTMLDivElement | null>; width: number; change: (width: number) => void }) {
  const [max, setMax] = useState(limit)
  const drag = useRef<Drag | undefined>(undefined)
  function preview(value: Drag) {
    value.root.style.setProperty('--sidebar-preferred-width', `${value.next}px`)
    value.handle.setAttribute('aria-valuenow', String(value.next))
    value.handle.setAttribute('aria-valuetext', `${value.next} pixels`)
  }
  function finish(save: boolean) {
    const value = drag.current
    if (!value) return
    drag.current = undefined
    if (value.frame !== undefined) cancelAnimationFrame(value.frame)
    value.next = save ? bounded(value.next) : value.preference
    preview(value)
    value.root.classList.remove('sidebar-resizing')
    if (value.handle.hasPointerCapture(value.pointer)) value.handle.releasePointerCapture(value.pointer)
    if (save) commit(value.next)
    else {
      const actual = bounded(value.preference)
      value.handle.setAttribute('aria-valuenow', String(actual))
      value.handle.setAttribute('aria-valuetext', `${actual} pixels`)
    }
  }
  function commit(value: number) {
    const next = bounded(value)
    try { localStorage.setItem(preferenceKey, String(next)) } catch { /* Keep the session preference when storage is unavailable. */ }
    change(next)
  }
  useEffect(() => {
    const resize = () => { setMax(limit()); finish(false) }
    const cancel = () => finish(false)
    window.addEventListener('resize', resize)
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('blur', cancel); cancel() }
    // Drag operations live in a ref; viewport changes cancel rather than commit them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div className="sidebar-resize" role="separator" tabIndex={0} aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="desktop-navigation" aria-valuemin={minimum} aria-valuemax={max} aria-valuenow={Math.min(width, max)} aria-valuetext={`${Math.min(width, max)} pixels`} data-tooltip="Drag to resize · Arrow keys to adjust · Double-click to reset"
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary || !root.current) return
      event.preventDefault(); event.currentTarget.focus()
      const value: Drag = { root: root.current, handle: event.currentTarget, pointer: event.pointerId, startX: event.clientX, startWidth: root.current.querySelector('.sidebar-shell')!.getBoundingClientRect().width, preference: width, next: bounded(width) }
      drag.current = value
      value.root.classList.add('sidebar-resizing')
      value.handle.setPointerCapture(value.pointer)
    }}
    onPointerMove={event => {
      const value = drag.current
      if (!value || event.pointerId !== value.pointer) return
      value.next = bounded(value.startWidth + event.clientX - value.startX)
      if (value.frame === undefined) value.frame = requestAnimationFrame(() => { value.frame = undefined; preview(value) })
    }}
    onPointerUp={event => { if (event.pointerId === drag.current?.pointer) finish(true) }}
    onPointerCancel={event => { if (event.pointerId === drag.current?.pointer) finish(false) }}
    onLostPointerCapture={() => finish(false)}
    onDoubleClick={() => commit(defaultWidth)}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(false); return }
      if (drag.current) return
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      commit(event.key === 'Home' ? minimum : event.key === 'End' ? max : Math.min(width, max) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 24 : 8))
    }} />
}
