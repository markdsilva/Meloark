import { parseBlob } from 'music-metadata'
import type { TrackMetadata } from '../domain/models'

export async function readMetadata(file: File, fallback: string, artwork: boolean): Promise<TrackMetadata> {
  try {
    const parsed = await parseBlob(file, { duration: false, skipCovers: !artwork })
    const cover = parsed.common.picture?.find(picture => picture.type === 'Cover (front)') ?? parsed.common.picture?.[0]
    const image = cover && cover.data.length <= 16 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/i.test(cover.format)
      ? new Blob([new Uint8Array(cover.data).buffer], { type: cover.format }) : undefined
    const format = parsed.format
    const codec = format.codec ?? (format.container === 'AIFF' && format.lossless ? 'PCM' : undefined)
    const positive = (value?: number) => value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
    // A parser's MP3 CBR profile can be based on only its initial frames.
    // Preserve it as reported information, never as proof of constant bitrate.
    const pcm = /^(PCM|IEEE_FLOAT)/i.test(codec ?? '')
    return { title: parsed.common.title || fallback, artist: parsed.common.artist || '', album: parsed.common.album || '',
      duration: parsed.format.duration, codec, artwork: image,
      container: format.container, codecProfile: format.codecProfile,
      bitrate: positive(format.bitrate), bitrateKind: pcm ? 'constant' : 'reported',
      sampleRate: positive(format.sampleRate), bitsPerSample: format.lossless ? positive(format.bitsPerSample) : undefined,
      channels: positive(format.numberOfChannels), lossless: format.lossless, technicalVersion: 1,
      error: codec ? undefined : 'Audio format metadata could not be read.' }
  } catch (error) { return { title: fallback, artist: '', album: '', technicalVersion: 1, error: error instanceof Error ? error.message : 'Metadata unavailable.' } }
}
