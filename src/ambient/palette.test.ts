import { expect, it } from 'vitest'
import { amberPalette, blendPalette, extractPalette, fadeProgress, luminance, type RGB } from './palette'

function pixels(colors: number[][]) { return new Uint8ClampedArray(colors.flatMap(color => Array.from({ length: 64 }, () => color).flat())) }
it('preserves artwork hue, finds a second color and ignores transparent/white borders', () => {
  const palette = extractPalette(pixels([[255, 255, 255, 255], [0, 255, 0, 0], [210, 30, 40, 255], [30, 60, 200, 255]]))
  expect(palette.primary[0]).toBeGreaterThan(palette.primary[2] * 2)
  expect(palette.secondary[2]).toBeGreaterThan(palette.secondary[0] * 2)
  expect(extractPalette(pixels([[250, 0, 0, 0]]))).toEqual(amberPalette)
})
it('gives monochrome and black or white artwork a quiet neutral palette', () => {
  for (const shade of [0, 130, 255]) {
    const palette = extractPalette(pixels([[shade, shade, shade, 255]]))
    expect(new Set(palette.primary).size).toBe(1)
    expect(new Set(palette.secondary).size).toBe(1)
  }
})
it('does not turn a tiny contrasting speck into a broad secondary glow', () => {
  const sample = pixels(Array.from({ length: 16 }, () => [210, 30, 40, 255]))
  sample.set([30, 60, 200, 255], 0)
  const palette = extractPalette(sample)
  expect(palette.secondary[0]).toBeGreaterThan(palette.secondary[2] * 2)
})
it('bounds even extreme colors and blended backgrounds for small text contrast', () => {
  const text: RGB = [150, 144, 136]
  for (const r of [0, 40, 128, 255]) for (const g of [0, 40, 128, 255]) for (const b of [0, 40, 128, 255]) {
    const palette = extractPalette(pixels([[r, g, b, 255]]))
    for (const color of [palette.primary, palette.secondary, blendPalette(amberPalette, palette, .5).primary]) {
      expect(luminance(color)).toBeLessThanOrEqual(.018)
      expect((luminance(text) + .05) / (luminance(color) + .05)).toBeGreaterThanOrEqual(4.5)
    }
  }
})
it('resumes an interrupted fade from its visible mix without exceeding palette bounds', () => {
  expect(fadeProgress(-1)).toBeCloseTo(0)
  expect(fadeProgress(2)).toBeCloseTo(1)
  expect(fadeProgress(.5)).toBeCloseTo(.5)
  expect(fadeProgress(.25)).toBeLessThan(.25)
  const a = { primary: [60, 15, 15] as RGB, secondary: [25, 20, 20] as RGB }, b = { primary: [15, 20, 80] as RGB, secondary: [20, 20, 35] as RGB }
  expect(blendPalette(a, b, .5).primary).toEqual([37.5, 17.5, 47.5])
  expect(blendPalette(a, b, 0)).toEqual(a)
  expect(blendPalette(a, b, 1)).toEqual(b)
})
