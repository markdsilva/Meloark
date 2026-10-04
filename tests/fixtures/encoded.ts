// Generated structural packet fixtures. No user recordings, external downloads, or runtime decoder.
import { Output, BufferTarget, EncodedAudioPacketSource, EncodedPacket, Mp4OutputFormat, OggOutputFormat } from 'mediabunny'

export function mp3Frames(variable = false, info = false) {
  const frames: Uint8Array[] = []
  for (let i = 0; i < 80; i++) {
    const high = variable && i >= 40, rate = high ? 320 : 128, size = Math.floor(144000 * rate / 44100)
    const frame = new Uint8Array(size); frame.set([255, 251, high ? 224 : 144, 0])
    if (i === 0 && info) frame.set(new TextEncoder().encode('Info'), 36)
    frames.push(frame)
  }
  return combine(frames)
}
export function adtsFrames() {
  const frames: Uint8Array[] = []
  for (let i = 0; i < 80; i++) {
    const size = i < 40 ? 100 : 300, frame = new Uint8Array(size)
    frame.set([255, 241, 80, 128 | (size >> 11), (size >> 3) & 255, ((size & 7) << 5) | 31, 252]); frames.push(frame)
  }
  return combine(frames)
}
export function combine(parts: Uint8Array[]) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length } return out }
function crc(bytes: Uint8Array, width: 8 | 16) { let value = 0; for (const byte of bytes) { value ^= byte << (width - 8); for (let i = 0; i < 8; i++) value = ((value << 1) ^ ((value & (1 << (width - 1))) ? width === 8 ? 7 : 0x8005 : 0)) & ((1 << width) - 1) } return value }
export function flacFrames(count = 64) {
  const info = new Uint8Array(42), view = new DataView(info.buffer)
  info.set(new TextEncoder().encode('fLaC')); info.set([128, 0, 0, 34], 4)
  view.setUint16(8, 1024); view.setUint16(10, 1024)
  view.setBigUint64(18, (44100n << 44n) | (15n << 36n) | BigInt(count * 1024))
  const frames = [info]
  for (let i = 0; i < count; i++) {
    const number = i < 128 ? [i] : [192 | (i >> 6), 128 | (i & 63)]
    const header = new Uint8Array([255, 248, 169, 8, ...number, 0]); header[header.length - 1] = crc(header.slice(0, -1), 8)
    const body = i < count / 2 ? new Uint8Array([0, 0, 0]) : new Uint8Array(2049); if (i >= count / 2) body[0] = 2
    const frame = combine([header, body, new Uint8Array(2)]), checksum = crc(frame.slice(0, -2), 16)
    frame[frame.length - 2] = checksum >> 8; frame[frame.length - 1] = checksum & 255; frames.push(frame)
  }
  return combine(frames)
}
export function aiffPcm() {
  const count = 8000, bytes = new Uint8Array(54 + count * 2), view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset)
  text(0, 'FORM'); view.setUint32(4, bytes.length - 8); text(8, 'AIFF'); text(12, 'COMM'); view.setUint32(16, 18)
  view.setUint16(20, 1); view.setUint32(22, count); view.setUint16(26, 16); bytes.set([64, 11, 250, 0, 0, 0, 0, 0, 0, 0], 28)
  text(38, 'SSND'); view.setUint32(42, count * 2 + 8)
  return bytes
}
export async function muxedPackets(format: 'mp4' | 'ogg', preSkip = 0) {
  const target = new BufferTarget(), output = new Output({ target, format: format === 'mp4' ? new Mp4OutputFormat() : new OggOutputFormat() })
  const source = new EncodedAudioPacketSource(format === 'mp4' ? 'aac' : 'opus'); output.addAudioTrack(source)
  await output.start()
  const description = format === 'mp4' ? new Uint8Array([18, 16]) : new Uint8Array(19)
  if (format === 'ogg') { description.set(new TextEncoder().encode('OpusHead')); description[8] = 1; description[9] = 2; new DataView(description.buffer).setUint16(10, preSkip, true); new DataView(description.buffer).setUint32(12, 48000, true) }
  const duration = format === 'mp4' ? 1024 / 44100 : 0.02
  for (let i = 0; i < 80; i++) {
    const bytes = new Uint8Array(i < 40 ? 100 : 300); if (format === 'ogg') bytes[0] = 248
    await source.add(new EncodedPacket(bytes, 'key', i * duration, duration), i === 0 ? { decoderConfig: { codec: format === 'mp4' ? 'mp4a.40.2' : 'opus', sampleRate: format === 'mp4' ? 44100 : 48000, numberOfChannels: 2, description } } : undefined)
  }
  await output.finalize()
  return new Uint8Array(target.buffer!)
}

export function oggFlacFrames(split = false, count = 64) {
  const native = flacFrames(count), pages: Uint8Array[] = []; let sequence = 0
  function page(payload: Uint8Array, flags: number, granule: number, continuing = false) {
    const segments: number[] = []
    let length = payload.length
    while (length >= 255) { segments.push(255); length -= 255 }
    if (!continuing) segments.push(length)
    const bytes = new Uint8Array(27 + segments.length + payload.length), view = new DataView(bytes.buffer)
    bytes.set(new TextEncoder().encode('OggS')); bytes[5] = flags; view.setBigInt64(6, BigInt(granule), true)
    view.setUint32(14, 123, true); view.setUint32(18, sequence++, true); bytes[26] = segments.length
    bytes.set(segments, 27); bytes.set(payload, 27 + segments.length)
    // Independent table-based Ogg checksum generator.
    const table = Array.from({ length: 256 }, (_, index) => { let value = index << 24; for (let bit = 0; bit < 8; bit++) value = (value << 1) ^ (value < 0 ? 0x04c11db7 : 0); return value >>> 0 })
    let checksum = 0; for (const byte of bytes) checksum = ((checksum << 8) ^ table[((checksum >>> 24) ^ byte) & 255]) >>> 0
    view.setUint32(22, checksum, true); pages.push(bytes)
  }
  const streamInfo = native.slice(0, 42); streamInfo[4] = 0
  page(combine([new Uint8Array([127, 70, 76, 65, 67, 1, 0, 0, 1]), streamInfo]), 2, 0)
  page(new Uint8Array([132, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]), 0, 0)
  let offset = 42
  for (let index = 0; index < count; index++) {
    const length = (index < 128 ? 6 : 7) + (index < count / 2 ? 3 : 2049) + 2
    const frame = native.slice(offset, offset + length); offset += length
    if (split && index === count - 1) { page(frame.slice(0, 255), 0, -1, true); page(frame.slice(255), 5, (index + 1) * 1024) }
    else page(frame, index === count - 1 ? 4 : 0, (index + 1) * 1024)
  }
  return combine(pages)
}
