import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export interface MenuAction { label: string; run: () => void; disabled?: boolean; reason?: string; danger?: boolean; checked?: boolean }
export interface MenuAnchor { x: number; y: number; opener: HTMLElement }
export function menuAnchor(element: HTMLElement, x?: number, y?: number): MenuAnchor {
  const rect = element.getBoundingClientRect()
  return { x: x || rect.left, y: y || rect.bottom, opener: element }
}
export function Menu({ anchor, items, close, label = 'Actions' }: { anchor: MenuAnchor; items: MenuAction[]; close: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  useLayoutEffect(() => { closeRef.current = close })
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y })
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(anchor.x, innerWidth - rect.width - 8)), top: Math.max(8, Math.min(anchor.y, innerHeight - rect.height - 8)) })
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [anchor])
  useEffect(() => {
    const dismiss = (event: Event) => { if (!ref.current?.contains(event.target as Node)) closeRef.current() }
    const scroll = (event: Event) => {
      // Only scrolling an ancestor moves the anchor. Independent panels and the
      // menu itself may scroll without invalidating its position.
      if (event.target === document || event.target instanceof Element && event.target.contains(anchor.opener)) closeRef.current()
    }
    const resize = () => closeRef.current()
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', dismiss); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize)
      if (anchor.opener.isConnected) anchor.opener.focus({ preventScroll: true })
    }
  }, [anchor])
  return createPortal(<div ref={ref} style={position} className="action-menu" role="menu" aria-label={label} onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    event.stopPropagation()
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close() }
  }}>{items.map(item => <button key={item.label} role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked} aria-disabled={item.disabled || undefined} className={item.danger ? 'danger' : ''} onClick={() => { if (!item.disabled) { close(); item.run() } }}>
    <span>{item.checked ? '✓ ' : ''}{item.label}</span>{item.disabled && item.reason && <small>{item.reason}</small>}
  </button>)}</div>, anchor.opener.closest('dialog') ?? document.body)
}
export function ContextActions({ children, items, label, className = '', disabled = false }: { children: ReactNode; items: MenuAction[]; label: string; className?: string; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<MenuAnchor>()
  return <div className={`context-actions ${className}`} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setAnchor(menuAnchor(event.currentTarget, event.clientX, event.clientY)) }} onKeyDown={event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.stopPropagation(); setAnchor(menuAnchor(event.target as HTMLElement)) }
  }}>{children}<button className="icon-button ghost-button row-more" aria-label={label} disabled={disabled} aria-haspopup="menu" aria-expanded={!!anchor} onClick={event => { event.stopPropagation(); setAnchor(menuAnchor(event.currentTarget)) }}><MoreHorizontal size={18} /></button>
    {anchor && <Menu anchor={anchor} items={items} label={label} close={() => setAnchor(undefined)} />}
  </div>
}
