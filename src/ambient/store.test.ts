import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { amberPalette } from './palette'

beforeEach(() => { vi.resetModules(); localStorage.removeItem('meloark-artwork-backgrounds') })
afterEach(() => { localStorage.removeItem('meloark-artwork-backgrounds') })
it('continues an interrupted fade from the currently visible colors', async () => {
  const { showPalette, useAmbient } = await import('./store')
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
  const red = { primary: [60, 15, 15] as const, secondary: [25, 20, 20] as const }
  showPalette(red)
  clock.mockReturnValue(1900)
  showPalette({ primary: [15, 20, 80], secondary: [20, 20, 35] })
  const state = useAmbient.getState()
  for (let channel = 0; channel < 3; channel++) expect(state.from.primary[channel]).toBeCloseTo((amberPalette.primary[channel] + red.primary[channel]) / 2)
  expect(state.revision).toBe(2)
})
it('remembers the toggle and remains usable when saving the preference fails', async () => {
  localStorage.setItem('meloark-artwork-backgrounds', 'off')
  const { toggleAmbient, useAmbient } = await import('./store')
  expect(useAmbient.getState().enabled).toBe(false)
  toggleAmbient()
  expect(localStorage.getItem('meloark-artwork-backgrounds')).toBe('on')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  expect(toggleAmbient).not.toThrow()
  expect(useAmbient.getState().enabled).toBe(false)
})
it('uses the settled colors when reduced motion is enabled during a fade', async () => {
  const { showPalette, useAmbient } = await import('./store')
  const first = { primary: [60, 15, 15] as const, secondary: [25, 20, 20] as const }
  showPalette(first)
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
  showPalette(amberPalette)
  expect(useAmbient.getState().from).toEqual(first)
})
