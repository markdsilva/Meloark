import { Input, BlobSource, EncodedPacketSink, MP3, MP4, FLAC, OGG, ADTS, WAVE } from 'mediabunny'
import { declaredMp3Bitrate, windowBitrate, type PacketPoint } from './bitrateMath'

export interface BitrateSample { bitrate: number; kind: 'live' | 'constant'; start: number; end: number; average?: number }
export class BitrateReader {
  private input?: Input
  private sink?: EncodedPacketSink
  private points: PacketPoint[] = []
  private constant?: number
  private declared?: number
  private opened = false
  private oggFlac?: import('./oggFlacReader').OggFlacReader
  private coveredUntil = 0
  private totalBytes = 0
  private totalDuration = 0
  private completeAverage?: number
  private continuous = false
  constructor(private file: File) {}
  private async open() {
    if (this.opened) return
    const magic = new Uint8Array(await this.file.slice(0, 12).arrayBuffer())
    if (String.fromCharCode(...magic.slice(0, 4)) === 'OggS') {
      const header = new Uint8Array(await this.file.slice(0, 79).arrayBuffer())
      const packet = 27 + header[26]
      if (header[packet] === 127 && String.fromCharCode(...header.slice(packet + 1, packet + 5)) === 'FLAC') {
        const { OggFlacReader } = await import('./oggFlacReader')
        this.oggFlac = new OggFlacReader(this.file); this.opened = true; return
      }
    }
    if (String.fromCharCode(...magic.slice(0, 4)) === 'FORM') {
      const { readMetadata } = await import('./parser')
      const m = await readMetadata(this.file, this.file.name, false)
      if (m.lossless && m.sampleRate && m.bitsPerSample && m.channels) this.constant = Math.ceil(m.bitsPerSample / 8) * 8 * m.sampleRate * m.channels
      else throw new Error('Live analysis is unavailable for this AIFF compression variant.')
    } else {
      this.input = new Input({ source: new BlobSource(this.file, { maxCacheSize: 8 * 1024 * 1024 }), formats: [MP3, MP4, FLAC, OGG, ADTS, WAVE] })
      const track = await this.input.getPrimaryAudioTrack()
      if (!track) throw new Error('No readable audio packets were found.')
      const codec = await track.getCodec()
      const width = codec?.startsWith('pcm-') ? Number(/\d+/.exec(codec)?.[0]) : codec === 'ulaw' || codec === 'alaw' ? 8 : 0
      if (width) this.constant = width * await track.getSampleRate() * await track.getNumberOfChannels()
      this.sink = new EncodedPacketSink(track)
      if (codec === 'mp3') this.declared = await declaredMp3Bitrate(this.file)
    }
    this.opened = true
  }
  async sample(position: number): Promise<BitrateSample> {
    await this.open()
    if (this.oggFlac) return this.oggFlac.sample(position)
    const start = Math.max(0, position - 0.5), end = position + 0.5
    if (this.constant) return { bitrate: this.constant, kind: 'constant', start, end, average: this.constant }
    const sink = this.sink!
    // Reuse compact packet metadata for nearby positions; raw packet buffers never leave the demuxer.
    const covered = this.points.length && this.points[0].timestamp <= start && this.points.at(-1)!.timestamp + this.points.at(-1)!.duration >= end
    if (!covered) {
      this.points = []
      let packet = start === 0 ? await sink.getFirstPacket({ metadataOnly: true }) : await sink.getPacket(start, { metadataOnly: true }) ?? await sink.getFirstPacket({ metadataOnly: true })
      // Accumulate only consecutive coverage, without retaining a whole-file packet index.
      // A forward seek leaves the average unverified until complete coverage is obtained.
      if (start === 0 && packet) { this.coveredUntil = packet.timestamp; this.totalBytes = 0; this.totalDuration = 0; this.continuous = true }
      while (packet && packet.timestamp < end + 2) {
        this.points.push({ timestamp: packet.timestamp, duration: packet.duration, byteLength: packet.byteLength })
        if (packet.timestamp + packet.duration > this.coveredUntil + 0.000001) {
          if (Math.abs(packet.timestamp - this.coveredUntil) > 0.000001) this.continuous = false
          if (this.continuous) { this.totalBytes += packet.byteLength; this.totalDuration += packet.duration; this.coveredUntil = packet.timestamp + packet.duration }
        }
        if (this.points.length > 10000) throw new Error('Audio packet timing exceeded the analysis limit.')
        packet = await sink.getNextPacket(packet, { metadataOnly: true })
      }
      if (!packet && this.continuous && this.totalDuration > 0) this.completeAverage = this.totalBytes * 8 / this.totalDuration
    }
    const bitrate = windowBitrate(this.points, start, end)
    if (!bitrate || !Number.isFinite(bitrate)) throw new Error('Reliable packet timing is unavailable for this file.')
    if (this.declared && Math.abs(bitrate - this.declared) / this.declared > 0.02) this.declared = undefined
    return { bitrate: this.declared ?? bitrate, kind: this.declared ? 'constant' : 'live', start, end, average: this.completeAverage }
  }
  dispose() { this.input?.dispose(); this.oggFlac?.dispose(); this.points = [] }
}
