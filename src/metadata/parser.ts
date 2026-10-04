import { parseBlob } from 'music-metadata'
import type { TrackMetadata } from '../domain/models'

export async function readMetadata(file: File, fallback: string, artwork: boolean): Promise<TrackMetadata> {
  try {
    const parsed = await parseBlob(file, { duration: false, skipCovers: !artwork })
    const cover = parsed.common.picture?.find(picture => picture.type === 'Cover (front)') ?? parsed.common.picture?.[0]
    const image = cover && cover.data.length <= 16 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/i.test(cover.format)
      ? new Blob([new Uint8Array(cover.data).buffer], { type: cover.format }) : undefined
    return { title: parsed.common.title || fallback, artist: parsed.common.artist || '', album: parsed.common.album || '',
      duration: parsed.format.duration, codec: parsed.format.codec, artwork: image,
      error: parsed.format.codec ? undefined : 'Audio format metadata could not be read.' }
  } catch (error) { return { title: fallback, artist: '', album: '', error: error instanceof Error ? error.message : 'Metadata unavailable.' } }
}
