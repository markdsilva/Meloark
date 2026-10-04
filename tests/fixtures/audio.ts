// Small, generated PCM samples; no copyrighted or user audio is bundled.
export function wavSample(seconds = 1, frequency = 220): Uint8Array {
  const rate = 8000, count = rate * seconds, bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true)
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(i / rate * Math.PI * 2 * frequency) * 1200, true)
  return bytes
}
