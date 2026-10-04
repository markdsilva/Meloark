import { BitrateReader } from './bitrateReader'

let reader: BitrateReader | undefined, key = ''
self.onmessage = async (event: MessageEvent<{ id: number; key: string; file?: File; position: number }>) => {
  const request = event.data
  try {
    if (request.key !== key || !reader) {
      reader?.dispose()
      if (!request.file) throw new Error('The local audio file is no longer available.')
      key = request.key; reader = new BitrateReader(request.file)
    }
    self.postMessage({ id: request.id, key, sample: await reader.sample(request.position) })
  } catch (error) {
    reader?.dispose(); reader = undefined
    self.postMessage({ id: request.id, key: request.key, error: error instanceof Error ? error.message : 'Live analysis is unavailable for this format.' })
  }
}
