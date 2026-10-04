import { readMetadata } from './parser'
const worker = self as unknown as { onmessage: ((event: MessageEvent<{ id: number; file: File; fallback: string; artwork: boolean }>) => void) | null; postMessage: (value: unknown) => void }
worker.onmessage = event => {
  const { id, file, fallback, artwork } = event.data
  void readMetadata(file, fallback, artwork).then(metadata => worker.postMessage({ id, metadata }))
}
