import { extractPalette } from './palette'

self.onmessage = async (event: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = event.data
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(blob, { resizeWidth: 32, resizeHeight: 32, resizeQuality: 'low' })
    const canvas = new OffscreenCanvas(32, 32), context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('No image sampler')
    context.drawImage(bitmap, 0, 0, 32, 32)
    self.postMessage({ id, palette: extractPalette(context.getImageData(0, 0, 32, 32).data) })
  } catch { self.postMessage({ id }) }
  finally { bitmap?.close() }
}
