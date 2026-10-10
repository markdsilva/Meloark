import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { useMediaQuery } from './useMediaQuery'

export interface SelectOption { value: string; label: string; disabled?: boolean; reason?: string }
export function Select({ label, accessibleLabel = label, value, options, disabled = false, onChange }: {
  label: string; accessibleLabel?: string; value: string; options: SelectOption[]; disabled?: boolean; onChange: (value: string) => void
}) {
  const id = useId(), opener = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const touch = useMediaQuery('(max-width: 767px), (pointer: coarse)')
  // Large inventories keep the browser’s native option handling.
  const native = touch || options.length > 200
  const [open, setOpen] = useState(false), [active, setActive] = useState(value), [position, setPosition] = useState<CSSProperties>()
  const typeahead = useRef({ text: '', time: 0 })
  const visible = open && !native && !disabled
  const enabled = options.filter(option => !option.disabled)
  const activeIndex = options.findIndex(option => option.value === active)
  function dismiss(focus = false) { setOpen(false); if (focus) opener.current?.focus({ preventScroll: true }) }
  function choose(option: SelectOption) { if (option.disabled) return; onChange(option.value); dismiss(true) }
  function expand() { setActive(enabled.some(option => option.value === value) ? value : enabled[0]?.value ?? ''); setOpen(true) }
  function keys(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && visible) { event.preventDefault(); event.stopPropagation(); dismiss(); return }
    if (event.key === 'Tab') { dismiss(); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const index = enabled.findIndex(option => option.value === (visible ? active : value))
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : !visible ? Math.max(0, index) : Math.max(0, Math.min(enabled.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      setActive(enabled[next]?.value ?? ''); setOpen(true); return
    }
    if ((event.key === 'Enter' || event.key === ' ') && visible) {
      event.preventDefault(); const option = options.find(item => item.value === active); if (option) choose(option); return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.preventDefault()
      const now = performance.now(), last = typeahead.current
      const text = now - last.time < 700 ? last.text + event.key.toLowerCase() : event.key.toLowerCase()
      typeahead.current = { text, time: now }
      const query = [...text].every(char => char === text[0]) ? text[0] : text
      const start = enabled.findIndex(option => option.value === active)
      const ordered = [...enabled.slice(start + 1), ...enabled.slice(0, start + 1)]
      const match = ordered.find(option => option.label.toLowerCase().startsWith(query))
      if (match) { setActive(match.value); setOpen(true) }
    }
  }
  useLayoutEffect(() => {
    if (!visible) return
    function place() {
      const rect = opener.current?.getBoundingClientRect()
      if (!rect) return
      const spaceBelow = innerHeight - rect.bottom - 16, spaceAbove = rect.top - 16
      const below = spaceBelow >= 180 || spaceBelow >= spaceAbove
      const height = Math.max(60, Math.min(320, below ? spaceBelow : spaceAbove))
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8)), width: Math.min(rect.width, innerWidth - 16), maxHeight: height, ...(below ? { top: rect.bottom + 6 } : { bottom: innerHeight - rect.top + 6 }) })
    }
    place()
    const resize = new ResizeObserver(place); if (opener.current) resize.observe(opener.current)
    window.addEventListener('resize', place)
    return () => { resize.disconnect(); window.removeEventListener('resize', place) }
  }, [visible])
  useEffect(() => {
    if (!visible) return
    const outside = (event: Event) => { if (!popup.current?.contains(event.target as Node) && !opener.current?.contains(event.target as Node)) setOpen(false) }
    const scroll = (event: Event) => { if (event.target === document || event.target instanceof Element && event.target.contains(opener.current)) setOpen(false) }
    document.addEventListener('pointerdown', outside); document.addEventListener('scroll', scroll, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', scroll, true) }
  }, [visible])
  useLayoutEffect(() => {
    if (visible) popup.current?.querySelector<HTMLElement>(`[id="${id}-option-${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [visible, activeIndex, id])
  return <div className="field select-field"><span id={`${id}-label`}>{label}</span>
    {native ? <div className="native-select"><select aria-label={accessibleLabel} data-value={value} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.reason ? ` · ${option.reason}` : ''}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></div> : <button ref={opener} type="button" className="select-trigger" role="combobox" aria-label={accessibleLabel} aria-expanded={visible} aria-controls={visible ? `${id}-list` : undefined} aria-haspopup="listbox" aria-activedescendant={visible && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined} disabled={disabled} data-value={value} onClick={() => visible ? dismiss() : expand()} onKeyDown={keys}><span>{options.find(option => option.value === value)?.label ?? 'Choose an option'}</span><ChevronDown size={16} aria-hidden="true" /></button>}
    {visible && createPortal(<div ref={popup} className="select-popup" id={`${id}-list`} role="listbox" aria-label={accessibleLabel} style={position} onClick={event => event.stopPropagation()}>{options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-value={option.value} className={`select-option ${option.value === active ? 'highlighted' : ''}`} onPointerMove={() => { if (!option.disabled) setActive(option.value) }} onPointerDown={event => event.preventDefault()} onClick={() => choose(option)}><span>{option.label}{option.reason && <small>{option.reason}</small>}</span>{option.value === value && <Check size={15} aria-hidden="true" />}</div>)}</div>, opener.current?.closest('dialog') ?? document.body)}
  </div>
}
