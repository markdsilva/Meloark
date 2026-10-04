import { useLayoutEffect, useRef, useState } from 'react'
export function BrowseTabs({ playlist, available, change }: { playlist: boolean; available: boolean; change: (view: 'library' | 'playlist') => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(0)
  useLayoutEffect(() => {
    const update = () => { const element = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]'); if (element) setLeft(element.offsetLeft + element.offsetWidth / 2 - 12) }
    update(); const observer = new ResizeObserver(update); if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [playlist])
  return <div ref={ref} className="browse-tabs" role="tablist" aria-label="Track views" data-tour="tabs" onKeyDown={event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const next = event.key === 'Home' ? false : event.key === 'End' ? available : available ? !playlist : false
      change(next ? 'playlist' : 'library'); ref.current?.querySelector<HTMLButtonElement>(next ? '#tab-playlist' : '#tab-library')?.focus()
    }
  }}><button id="tab-library" role="tab" aria-controls="browse-panel" aria-selected={!playlist} tabIndex={!playlist ? 0 : -1} className={!playlist ? 'active' : ''} onClick={() => change('library')}>All tracks</button><button id="tab-playlist" role="tab" aria-controls="browse-panel" aria-selected={playlist} tabIndex={playlist ? 0 : -1} className={playlist ? 'active' : ''} disabled={!available} data-tooltip={!available ? 'Create or open a playlist first' : undefined} onClick={() => change('playlist')}>Playlist</button><span className="tab-indicator" style={{ transform: `translateX(${left}px)` }} /></div>
}
