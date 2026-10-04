import { windowBitrate, type PacketPoint } from './bitrateMath'
import type { BitrateSample } from './bitrateReader'

// Ogg FLAC mapping 1.x: https://xiph.org/flac/ogg_mapping.html
// Frame timing/CRC: RFC 9639, section 9.1. This inspects headers, never decodes samples.
const signature = (bytes: Uint8Array, start: number, text: string) => [...text].every((char, index) => bytes[start + index] === char.charCodeAt(0))
function crc8(bytes: Uint8Array) {
  let value = 0
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = ((value << 1) ^ (value & 128 ? 7 : 0)) & 255 }
  return value
}
export function oggChecksum(bytes: Uint8Array) {
  let value = 0
  for (let index = 0; index < bytes.length; index++) {
    value ^= (index >= 22 && index < 26 ? 0 : bytes[index]) << 24
    for (let bit = 0; bit < 8; bit++) value = ((value << 1) ^ (value & 0x80000000 ? 0x04c11db7 : 0)) >>> 0
  }
  return value
}
function frameTiming(bytes: Uint8Array, rate: number, fixedBlock: number) {
  if (bytes.length < 6 || bytes[0] !== 255 || (bytes[1] & 254) !== 248 || (bytes[3] & 1)) throw new Error('Invalid Ogg FLAC frame header.')
  let cursor = 4, number = bytes[cursor++]
  if (number >= 128) {
    let count = 0; while (count < 8 && (number & (128 >> count))) count++
    if (count < 2 || count > 7) throw new Error('Invalid FLAC coded sample number.')
    const extra = count - 1; number &= (1 << (7 - count)) - 1
    for (let index = 0; index < extra; index++) { const next = bytes[cursor++]; if ((next & 192) !== 128) throw new Error('Invalid FLAC coded sample number.'); number = number * 64 + (next & 63) }
    if (number < [0, 128, 2048, 65536, 2097152, 67108864, 2147483648][extra]) throw new Error('Overlong FLAC coded sample number.')
  }
  const blockCode = bytes[2] >> 4, rateCode = bytes[2] & 15
  let block = blockCode === 1 ? 192 : blockCode >= 2 && blockCode <= 5 ? 576 << (blockCode - 2) : blockCode >= 8 ? 256 << (blockCode - 8) : 0
  if (blockCode === 6) block = bytes[cursor++] + 1
  if (blockCode === 7) { block = (bytes[cursor] << 8 | bytes[cursor + 1]) + 1; cursor += 2 }
  let frameRate = [rate, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000][rateCode]
  if (rateCode === 12) frameRate = bytes[cursor++] * 1000
  if (rateCode === 13 || rateCode === 14) { frameRate = (bytes[cursor] << 8 | bytes[cursor + 1]) * (rateCode === 14 ? 10 : 1); cursor += 2 }
  if (!block || frameRate !== rate || cursor >= bytes.length || crc8(bytes.slice(0, cursor)) !== bytes[cursor]) throw new Error('Ogg FLAC frame timing could not be verified.')
  const sample = bytes[1] & 1 ? number : number * fixedBlock
  if (!Number.isSafeInteger(sample) || sample < 0) throw new Error('Invalid FLAC sample position.')
  return { timestamp: sample / rate, duration: block / rate, sampleEnd: sample + block }
}

export class OggFlacReader {
  private offset = 0
  private serial?: number
  private sequence = 0
  private prefix = new Uint8Array(0)
  private packetLength = 0
  private rate = 0
  private fixedBlock = 0
  private headersRemaining = 0
  private haveComments = false
  private headersDone = false
  private points: PacketPoint[] = []
  private ended = false
  private nextSample = 0
  private bytes = 0
  private seconds = 0
  private continuous = true
  private average?: number
  private checkpoints: { offset: number; sequence: number; time: number }[] = []
  private cache?: { offset: number; bytes: Uint8Array }
  constructor(private file: File) {}
  private async read(offset: number, length: number) {
    const result = new Uint8Array(Math.max(0, Math.min(length, this.file.size - offset)))
    let copied = 0
    while (copied < result.length) {
      const position = offset + copied, block = Math.floor(position / 262144) * 262144
      if (this.cache?.offset !== block) this.cache = { offset: block, bytes: new Uint8Array(await this.file.slice(block, block + 262144).arrayBuffer()) }
      const start = position - block, take = Math.min(result.length - copied, this.cache.bytes.length - start)
      if (take <= 0) throw new Error('The Ogg FLAC source changed or became unreadable.')
      result.set(this.cache.bytes.subarray(start, start + take), copied); copied += take
    }
    return result
  }
  private async page() {
    const offset = this.offset
    const header = await this.read(offset, 27)
    if (header.length !== 27 || !signature(header, 0, 'OggS') || header[4] !== 0 || (header[5] & ~7)) throw new Error('Invalid or truncated Ogg page.')
    const count = header[26], lacing = await this.read(offset + 27, count)
    if (lacing.length !== count) throw new Error('Truncated Ogg lacing table.')
    const length = 27 + count + lacing.reduce((total, value) => total + value, 0)
    // One 256 KiB read cache and one Ogg page, well below the 8 MiB cap.
    const bytes = await this.read(offset, length), view = new DataView(bytes.buffer)
    if (bytes.length !== length || oggChecksum(bytes) !== view.getUint32(22, true)) throw new Error('Ogg page checksum failed.')
    const serial = view.getUint32(14, true), sequence = view.getUint32(18, true), flags = header[5]
    if (this.serial === undefined) { if (!(flags & 2) || sequence !== 0) throw new Error('Ogg FLAC beginning-of-stream header is missing.'); this.serial = serial }
    if (serial !== this.serial || sequence !== this.sequence || (offset > 0 && flags & 2)) throw new Error('Chained, multiplexed, or discontinuous Ogg FLAC is unavailable for live analysis.')
    if (!!(flags & 1) !== !!this.packetLength) throw new Error('Ogg packet continuation is inconsistent.')
    this.sequence++; this.offset += length
    let cursor = 27 + count, lastEnd: number | undefined, firstTime: number | undefined
    for (const segment of lacing) {
      const take = Math.min(segment, 64 - this.prefix.length)
      if (take > 0) { const prefix = new Uint8Array(this.prefix.length + take); prefix.set(this.prefix); prefix.set(bytes.subarray(cursor, cursor + take), this.prefix.length); this.prefix = prefix }
      cursor += segment; this.packetLength += segment
      if (segment === 255) continue
      const prefix = this.prefix
      if (!this.rate) {
        if (this.packetLength !== 51 || prefix[0] !== 127 || !signature(prefix, 1, 'FLAC') || prefix[5] !== 1 || !signature(prefix, 9, 'fLaC') || prefix[13] !== 0 || prefix[16] !== 34) throw new Error('Unsupported Ogg FLAC mapping header.')
        const info = new DataView(prefix.buffer); this.fixedBlock = info.getUint16(19)
        this.headersRemaining = info.getUint16(7)
        this.rate = prefix[27] * 4096 + prefix[28] * 16 + (prefix[29] >> 4)
        if (!this.rate || !this.fixedBlock) throw new Error('Invalid FLAC stream timing.')
      } else if (prefix[0] === 255) {
        if (!this.headersDone) throw new Error('Ogg FLAC metadata headers are incomplete.')
        const timing = frameTiming(prefix, this.rate, this.fixedBlock)
        if (this.nextSample >= 0 && Math.abs(timing.timestamp * this.rate - this.nextSample) > 0.001) throw new Error('Ogg FLAC frame ordering is discontinuous.')
        this.nextSample = timing.sampleEnd; lastEnd = timing.sampleEnd; firstTime ??= timing.timestamp
        this.points.push({ timestamp: timing.timestamp, duration: timing.duration, byteLength: this.packetLength })
        if (this.continuous) { this.bytes += this.packetLength; this.seconds += timing.duration }
      } else {
        if (this.headersDone || prefix.length < 4 || (prefix[0] & 127) === 127 || (!this.haveComments && (prefix[0] & 127) !== 4) || (prefix[1] * 65536 + prefix[2] * 256 + prefix[3]) !== this.packetLength - 4) throw new Error('Invalid Ogg FLAC metadata packet.')
        this.haveComments = true
        if (this.headersRemaining) this.headersRemaining--
        if (prefix[0] & 128) { if (this.headersRemaining) throw new Error('Ogg FLAC header count is inconsistent.'); this.headersDone = true }
      }
      this.prefix = new Uint8Array(0); this.packetLength = 0
    }
    const granule = view.getBigInt64(6, true)
    if (lastEnd !== undefined && granule !== BigInt(lastEnd)) throw new Error('Ogg FLAC granule timing is inconsistent.')
    if (firstTime !== undefined && !(flags & 1) && firstTime - (this.checkpoints.at(-1)?.time ?? -10) >= 10) {
      this.checkpoints.push({ offset, sequence, time: firstTime }); if (this.checkpoints.length > 128) this.checkpoints.shift()
    }
    if (flags & 4) {
      if (this.packetLength || this.offset !== this.file.size) throw new Error('Truncated or chained Ogg FLAC stream.')
      this.ended = true; if (this.continuous && this.seconds > 0) this.average = this.bytes * 8 / this.seconds
    } else if (this.offset === this.file.size) throw new Error('Ogg FLAC end-of-stream marker is missing.')
  }
  async sample(position: number): Promise<BitrateSample> {
    const start = Math.max(0, position - 0.5), end = position + 0.5
    if (this.points.length && start < this.points[0].timestamp) {
      const checkpoint = [...this.checkpoints].reverse().find(point => point.time <= start)
      this.offset = checkpoint?.offset ?? 0; this.sequence = checkpoint?.sequence ?? 0
      this.prefix = new Uint8Array(0); this.packetLength = 0; this.points = []; this.ended = false
      this.continuous = this.offset === 0 || checkpoint?.time === 0; this.nextSample = this.continuous ? 0 : -1; this.bytes = 0; this.seconds = 0
      if (this.offset === 0) { this.rate = 0; this.haveComments = false; this.headersDone = false }
    }
    while (!this.ended && (!this.points.length || this.points.at(-1)!.timestamp + this.points.at(-1)!.duration < end + 2)) {
      await this.page()
      this.points = this.points.filter(point => point.timestamp + point.duration >= start - 2)
      if (this.points.length > 10000) throw new Error('Ogg FLAC packet timing exceeded the analysis limit.')
    }
    const bitrate = windowBitrate(this.points, start, end)
    if (!bitrate || !Number.isFinite(bitrate)) throw new Error('No reliable Ogg FLAC packets cover this position.')
    return { bitrate, kind: 'live', start, end, average: this.average }
  }
  dispose() { this.cache = undefined; this.prefix = new Uint8Array(0); this.points = []; this.checkpoints = [] }
}
