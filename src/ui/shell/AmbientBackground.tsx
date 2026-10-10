import { useEffect, useMemo, type CSSProperties } from 'react'
import { Palette as PaletteIcon } from 'lucide-react'
import { usePlayer } from '../../playback/player'
import { artworkPalette } from '../../ambient/client'
import { amberPalette, fadeDuration, type Palette } from '../../ambient/palette'
import { showPalette, toggleAmbient, useAmbient } from '../../ambient/store'

export function AmbientController() {
  const blob = usePlayer(state => state.track?.metadata.artwork), enabled = useAmbient(state => state.enabled)
  useEffect(() => {
    let current = true
    if (!enabled || !blob) showPalette(amberPalette)
    else void artworkPalette(blob).then(palette => { if (current) showPalette(palette) })
    return () => { current = false }
  }, [blob, enabled])
  return null
}
function colors(palette: Palette): CSSProperties {
  return { '--ambient-primary': `rgb(${palette.primary.join(' ')})`, '--ambient-secondary': `rgb(${palette.secondary.join(' ')})` } as CSSProperties
}
export function AmbientBackground({ workspace = false }: { workspace?: boolean }) {
  const { from, to, revision, changedAt } = useAmbient()
  // Newly opened drawers join the shared fade instead of replaying old colors.
  // Keep this delay stable across unrelated renders of the same transition.
  const delay = useMemo(() => revision ? -Math.min(fadeDuration, Math.max(0, performance.now() - changedAt)) : 0, [revision, changedAt])
  return <div className={`ambient-background ${workspace ? 'ambient-workspace' : ''}`} aria-hidden="true">
    <div className="ambient-layer" style={colors(from)} />
    <div key={revision} className="ambient-layer ambient-arriving" style={{ ...colors(to), animationDelay: `${delay}ms` }} />
  </div>
}
export function AmbientToggle() {
  const enabled = useAmbient(state => state.enabled)
  return <button className={`icon-button ambient-toggle ${enabled ? 'active' : ''}`} aria-label="Artwork backgrounds" aria-pressed={enabled} data-tooltip={`Artwork backgrounds ${enabled ? 'on' : 'off'} · Use colors from the playing song`} onClick={toggleAmbient}><PaletteIcon size={18} /></button>
}
