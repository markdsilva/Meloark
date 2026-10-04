export interface PacketPoint { timestamp: number; duration: number; byteLength: number }

/** Boundary packets are apportioned by time; metadata/padding outside packets is excluded. */
export function windowBitrate(packets: PacketPoint[], start: number, end: number): number | undefined {
  let bytes = 0, seconds = 0
  for (const packet of packets) {
    if (!Number.isFinite(packet.duration) || packet.duration <= 0 || !Number.isFinite(packet.timestamp) || !Number.isFinite(packet.byteLength) || packet.byteLength <= 0) continue
    const overlap = Math.max(0, Math.min(end, packet.timestamp + packet.duration) - Math.max(start, packet.timestamp))
    bytes += packet.byteLength * overlap / packet.duration
    seconds += overlap
  }
  return seconds > 0 ? bytes * 8 / seconds : undefined
}

/** Only an explicit MPEG Info tag establishes declared CBR, not matching early frames. */
export async function declaredMp3Bitrate(file: Blob): Promise<number | undefined> {
  const first = new Uint8Array(await file.slice(0, 10).arrayBuffer())
  let offset = 0
  if (String.fromCharCode(...first.slice(0, 3)) === 'ID3') {
    if (first.slice(6, 10).some(byte => byte > 127)) return
    offset = 10 + ((first[6] << 21) | (first[7] << 14) | (first[8] << 7) | first[9]) + (first[3] === 4 && (first[5] & 16) ? 10 : 0)
  }
  const bytes = new Uint8Array(await file.slice(offset, offset + 4096).arrayBuffer())
  if (bytes[0] !== 255 || (bytes[1] & 224) !== 224 || ((bytes[1] >> 1) & 3) !== 1) return
  const version = (bytes[1] >> 3) & 3, index = bytes[2] >> 4, rateIndex = (bytes[2] >> 2) & 3
  if (version === 1 || index === 0 || index === 15 || rateIndex === 3) return
  const rates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  const mono = (bytes[3] >> 6) === 3
  const tagOffset = 4 + ((bytes[1] & 1) ? 0 : 2) + (version === 3 ? mono ? 17 : 32 : mono ? 9 : 17)
  return String.fromCharCode(...bytes.slice(tagOffset, tagOffset + 4)) === 'Info' ? rates[index] * 1000 : undefined
}
