import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const css = readFileSync('src/styles/tokens.css', 'utf8')
const color = (name: string) => new RegExp(`--${name}: (#[a-f0-9]{6})`).exec(css)![1]
function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}
const contrast = (a: string, b: string) => { const x = luminance(color(a)), y = luminance(color(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
it('keeps shared text and primary button tokens readable', () => {
  for (const background of ['bg', 'sidebar', 'surface', 'elevated', 'accent-soft']) for (const text of ['text', 'muted', 'subtle']) expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5)
  expect(contrast('on-accent', 'accent')).toBeGreaterThanOrEqual(4.5)
  expect(contrast('focus', 'bg')).toBeGreaterThanOrEqual(3)
})
