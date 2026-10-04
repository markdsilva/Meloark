import { applyMetadata, sources, useApp } from '../app/store'
import { dirname, type TrackMetadata } from '../domain/models'

interface Job { libraryId: string; generation: number; trackId: string; artwork: boolean }
const jobs: Job[] = []
const checkedArtwork = new Set<string>()
const cachedArtwork = new Map<string, { libraryId: string; trackId: string; size: number }>()
let cacheBytes = 0, running = false, worker: Worker | undefined, failedWorker = false, sequence = 0
const key = (job: Job) => `${job.libraryId}/${job.generation}/${job.trackId}/${job.artwork}`
const artKey = (job: Job) => `${job.libraryId}/${job.generation}/${job.trackId}`
const pending = new Set<string>()
function queue(job: Job, priority = false) {
  if (pending.has(key(job))) return
  pending.add(key(job))
  if (priority) jobs.unshift(job); else jobs.push(job)
}
export function scheduleMetadata(libraryId: string) {
  const library = useApp.getState().libraries.find(l => l.id === libraryId)
  if (!library?.connected) return
  // Count restored thumbnails as well as newly decoded artwork toward the cap.
  cachedArtwork.clear(); cacheBytes = 0
  for (const known of useApp.getState().libraries) for (const track of Object.values(known.tracks)) {
    if (track.metadata.artwork) {
      cachedArtwork.set(`${known.id}/${known.generation}/${track.id}`, { libraryId: known.id, trackId: track.id, size: track.metadata.artwork.size })
      cacheBytes += track.metadata.artwork.size
    }
  }
  for (const track of Object.values(library.tracks)) if (track.metadataStatus === 'pending' || track.metadataStatus === 'loading' || track.metadata.technicalVersion !== 1) queue({ libraryId, generation: library.generation, trackId: track.id, artwork: false })
  void drain()
}
export function prioritizeMetadata(libraryId: string, ids: string[]) {
  const library = useApp.getState().libraries.find(l => l.id === libraryId)
  if (!library?.connected) return
  for (const trackId of [...ids].reverse()) {
    const job = { libraryId, generation: library.generation, trackId, artwork: true }
    if (!checkedArtwork.has(artKey(job))) queue(job, true)
  }
  void drain()
}
async function parse(file: File, fallback: string, artwork: boolean): Promise<TrackMetadata> {
  if (!failedWorker && typeof Worker !== 'undefined') {
    try {
      worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      const current = worker, id = ++sequence
      return await new Promise<TrackMetadata>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Metadata worker timed out.')), 15_000)
        current.onmessage = event => { if (event.data.id === id) { clearTimeout(timer); resolve(event.data.metadata) } }
        current.onerror = () => { clearTimeout(timer); reject(new Error('Metadata worker unavailable.')) }
        current.postMessage({ id, file, fallback, artwork })
      })
    } catch { worker?.terminate(); worker = undefined; failedWorker = true }
  }
  await new Promise(resolve => setTimeout(resolve, 0))
  const { readMetadata } = await import('./parser')
  return readMetadata(file, fallback, artwork)
}
async function thumbnail(image: Blob): Promise<Blob | undefined> {
  if (image.size > 16 * 1024 * 1024) return undefined
  const url = URL.createObjectURL(image)
  try {
    const element = new Image(); element.src = url
    await element.decode()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192
    const context = canvas.getContext('2d')
    if (!context) return undefined
    const scale = Math.max(192 / element.width, 192 / element.height)
    context.drawImage(element, (192 - element.width * scale) / 2, (192 - element.height * scale) / 2, element.width * scale, element.height * scale)
    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob ?? undefined), 'image/webp', 0.8))
  } catch { return undefined } finally { URL.revokeObjectURL(url) }
}
async function drain() {
  if (running) return
  running = true
  try {
    while (jobs.length) {
      const job = jobs.shift()!
      try {
        const library = useApp.getState().libraries.find(l => l.id === job.libraryId), source = sources.get(job.libraryId), track = library?.tracks[job.trackId]
        if (!library?.connected || library.generation !== job.generation || !source || !track) continue
        if (!job.artwork && track.metadata.technicalVersion === 1 && (track.metadataStatus === 'ready' || checkedArtwork.has(artKey(job)))) continue
        let metadata = await parse(await source.readFile(track.path), track.metadata.title, job.artwork)
        if (job.artwork) {
          checkedArtwork.add(artKey(job))
          let art = metadata.artwork
          if (!art) {
            const folder = dirname(track.path)
            const image = library.files.find(path => dirname(path) === folder && /^(cover|folder|front|album)\.(jpg|jpeg|png|webp)$/i.test(path.split('/').at(-1)!))
            if (image) { const file = await source.readFile(image); if (file.size <= 16 * 1024 * 1024) art = file }
          }
          metadata = { ...metadata, artwork: art ? await thumbnail(art) : undefined }
          if (metadata.artwork) {
            const cacheKey = artKey(job), old = cachedArtwork.get(cacheKey)
            if (old) cacheBytes -= old.size
            cachedArtwork.delete(cacheKey)
            cachedArtwork.set(cacheKey, { libraryId: job.libraryId, trackId: job.trackId, size: metadata.artwork.size })
            cacheBytes += metadata.artwork.size
          }
        } else metadata = { ...metadata, artwork: track.metadata.artwork }
        applyMetadata(job.libraryId, job.generation, job.trackId, metadata)
        while (cacheBytes > 64 * 1024 * 1024 && cachedArtwork.size) {
          const [oldKey, old] = cachedArtwork.entries().next().value!
          cacheBytes -= old.size; cachedArtwork.delete(oldKey); checkedArtwork.delete(oldKey)
          const oldLibrary = useApp.getState().libraries.find(l => l.id === old.libraryId), oldTrack = oldLibrary?.tracks[old.trackId]
          if (oldLibrary && oldTrack) applyMetadata(old.libraryId, oldLibrary.generation, old.trackId, { ...oldTrack.metadata, artwork: undefined }, true)
        }
      } catch { /* One unreadable track must not stop library browsing. */ }
      finally { pending.delete(key(job)) }
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  } finally { running = false }
}
