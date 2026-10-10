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
// RIFF INFO strings use Latin-1; these tags exercise the real metadata reader.
export function taggedWav(seconds: number, tags: { title: string; artist: string; album: string }): Uint8Array {
  const audio = wavSample(seconds), encoder = new TextEncoder()
  const chunks = [['INAM', tags.title], ['IART', tags.artist], ['IPRD', tags.album]].map(([key, value]) => {
    const text = Uint8Array.from(`${value}\0`, char => char.charCodeAt(0)), chunk = new Uint8Array(8 + text.length + text.length % 2)
    chunk.set(encoder.encode(key)); new DataView(chunk.buffer).setUint32(4, text.length, true); chunk.set(text, 8)
    return chunk
  })
  const size = 4 + chunks.reduce((total, chunk) => total + chunk.length, 0), bytes = new Uint8Array(audio.length + 8 + size)
  bytes.set(audio); bytes.set(encoder.encode('LIST'), audio.length); new DataView(bytes.buffer).setUint32(audio.length + 4, size, true)
  bytes.set(encoder.encode('INFO'), audio.length + 8)
  let offset = audio.length + 12
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true)
  return bytes
}
