import { create } from 'zustand'
import { amberPalette, blendPalette, fadeDuration, fadeProgress, type Palette } from './palette'

const preference = 'meloark-artwork-backgrounds'
function readEnabled() { try { return localStorage.getItem(preference) !== 'off' } catch { return true } }
export const useAmbient = create(() => ({ enabled: readEnabled(), from: amberPalette, to: amberPalette, changedAt: 0, revision: 0 }))
export function toggleAmbient() {
  const enabled = !useAmbient.getState().enabled
  try { localStorage.setItem(preference, enabled ? 'on' : 'off') } catch { /* Keep the session preference. */ }
  useAmbient.setState({ enabled })
}
export function showPalette(to: Palette) {
  const state = useAmbient.getState()
  if (JSON.stringify(to) === JSON.stringify(state.to)) return
  const now = performance.now(), reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const progress = !state.changedAt || reduced ? 1 : fadeProgress((now - state.changedAt) / fadeDuration)
  useAmbient.setState({ from: blendPalette(state.from, state.to, progress), to, changedAt: now, revision: state.revision + 1 })
}
