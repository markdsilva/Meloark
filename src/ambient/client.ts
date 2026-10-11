import { amberPalette, type Palette } from './palette'

interface Job { id: number; blob: Blob; resolve: (palette: Palette) => void }
const cache = new WeakMap<Blob, Palette>(), pending = new WeakMap<Blob, Promise<Palette>>()
let worker: Worker | undefined, active: Job | undefined, queued: Job | undefined, nextId = 0
let timeout: ReturnType<typeof setTimeout> | undefined, idle: ReturnType<typeof setTimeout> | undefined

function finish(palette?: Palette) {
  clearTimeout(timeout)
  if (active) {
    if (palette) cache.set(active.blob, palette)
    pending.delete(active.blob); active.resolve(palette ?? amberPalette); active = undefined
  }
  if (queued) { const next = queued; queued = undefined; start(next) }
  else idle = setTimeout(() => { worker?.terminate(); worker = undefined }, 60_000)
}
function failed() { worker?.terminate(); worker = undefined; finish() }
function start(job: Job) {
  clearTimeout(idle); active = job
  try {
    if (!worker) {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      const current = worker
      worker.onmessage = (event: MessageEvent<{ id: number; palette?: Palette }>) => { if (worker === current && active?.id === event.data.id) finish(event.data.palette) }
      worker.onerror = () => { if (worker === current) failed() }
      worker.onmessageerror = () => { if (worker === current) failed() }
    }
    timeout = setTimeout(failed, 4000)
    worker.postMessage({ id: job.id, blob: job.blob })
  } catch { failed() }
}
export function artworkPalette(blob: Blob): Promise<Palette> {
  const existing = cache.get(blob)
  if (existing) return Promise.resolve(existing)
  const loading = pending.get(blob)
  if (loading) return loading
  if (blob.size > 20 * 1024 * 1024 || typeof Worker === 'undefined') return Promise.resolve(amberPalette)
  let resolve!: (palette: Palette) => void
  const promise = new Promise<Palette>(done => { resolve = done })
  pending.set(blob, promise)
  const job = { id: ++nextId, blob, resolve }
  if (!active) start(job)
  else {
    // Rapid skips keep at most one decode and the newest waiting artwork.
    if (queued) { pending.delete(queued.blob); queued.resolve(amberPalette) }
    queued = job
  }
  return promise
}
