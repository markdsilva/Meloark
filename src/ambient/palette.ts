export type RGB = readonly [number, number, number]
export interface Palette { primary: RGB; secondary: RGB }
export const amberPalette: Palette = { primary: [43, 33, 22], secondary: [29, 27, 25] }
export const fadeDuration = 1800

export function luminance(rgb: RGB) {
  const channels = rgb.map(value => { const unit = value / 255; return unit <= .04045 ? unit / 12.92 : ((unit + .055) / 1.055) ** 2.4 })
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}
function tint(rgb: RGB, ceiling: number): RGB {
  const mean = (Math.max(...rgb) + Math.min(...rgb)) / 2
  const softened = rgb.map(value => value * .78 + mean * .22) as unknown as RGB
  let low = 0, high = 1
  for (let step = 0; step < 18; step++) {
    const scale = (low + high) / 2
    if (luminance(softened.map(value => value * scale) as unknown as RGB) <= ceiling) low = scale
    else high = scale
  }
  return softened.map(value => Math.floor(value * low)) as unknown as RGB
}

// Only the worker's 32 × 32 sample reaches this function. Weight broad color
// regions above white borders and black backgrounds, without amplifying specks.
export function extractPalette(pixels: Uint8ClampedArray): Palette {
  const buckets = new Map<number, { sum: number[]; weight: number }>()
  let opaque = 0
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const [r, g, b, alpha] = pixels.subarray(index, index + 4)
    if (alpha < 128) continue
    opaque++
    const brightest = Math.max(r, g, b), darkest = Math.min(r, g, b)
    if (brightest < 24 || darkest > 230) continue
    const saturation = brightest ? (brightest - darkest) / brightest : 0
    const weight = (.3 + saturation) * (alpha / 255)
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5)
    const bucket = buckets.get(key) ?? { sum: [0, 0, 0], weight: 0 }
    bucket.weight += weight
    bucket.sum[0] += r * weight; bucket.sum[1] += g * weight; bucket.sum[2] += b * weight
    buckets.set(key, bucket)
  }
  if (!opaque) return amberPalette
  const colors = [...buckets.values()].sort((a, b) => b.weight - a.weight).map(bucket => ({ weight: bucket.weight, rgb: bucket.sum.map(value => value / bucket.weight) as unknown as RGB }))
  const primary = colors[0]?.rgb ?? [38, 38, 38]
  const secondary = colors.find(color => color.weight >= colors[0].weight * .12 && Math.hypot(...color.rgb.map((value, channel) => value - primary[channel])) > 70)?.rgb ?? primary
  return { primary: tint(primary, .018), secondary: tint(secondary, .012) }
}

export function blendPalette(from: Palette, to: Palette, fraction: number): Palette {
  const mix = (a: RGB, b: RGB) => a.map((value, channel) => value + (b[channel] - value) * fraction) as unknown as RGB
  return { primary: mix(from.primary, to.primary), secondary: mix(from.secondary, to.secondary) }
}
// Match CSS ease-in-out so an interrupted fade can resume from its visible mix.
export function fadeProgress(fraction: number) {
  const x = Math.max(0, Math.min(1, fraction))
  let low = 0, high = 1
  for (let step = 0; step < 18; step++) {
    const t = (low + high) / 2, inverse = 1 - t
    if (3 * inverse * inverse * t * .42 + 3 * inverse * t * t * .58 + t ** 3 < x) low = t
    else high = t
  }
  const t = (low + high) / 2
  return 3 * (1 - t) * t * t + t ** 3
}
