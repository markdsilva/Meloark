import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { amberPalette } from './palette'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage?: (event: { data: unknown }) => void
  onerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
  complete(palette?: typeof amberPalette) {
    const id = this.postMessage.mock.lastCall![0].id
    this.onmessage?.({ data: { id, palette } })
  }
}
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('caches artwork and coalesces rapid skips to one active and one waiting decode', async () => {
  const { artworkPalette } = await import('./client')
  const a = new Blob(['a']), b = new Blob(['b']), c = new Blob(['c'])
  const first = artworkPalette(a)
  expect(artworkPalette(a)).toBe(first)
  const discarded = artworkPalette(b), latest = artworkPalette(c), worker = FakeWorker.instances[0]
  expect(worker.postMessage).toHaveBeenCalledTimes(1)
  await expect(discarded).resolves.toEqual(amberPalette)
  worker.complete(amberPalette)
  await expect(first).resolves.toEqual(amberPalette)
  expect(worker.postMessage).toHaveBeenCalledTimes(2)
  expect(worker.postMessage.mock.lastCall![0].blob).toBe(c)
  worker.complete(amberPalette)
  await expect(latest).resolves.toEqual(amberPalette)
  await expect(artworkPalette(a)).resolves.toEqual(amberPalette)
  expect(worker.postMessage).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(60_000)
  expect(worker.terminate).toHaveBeenCalledOnce()
})
it('recovers from failed and stalled decoding, without caching a failed palette', async () => {
  const { artworkPalette } = await import('./client'), blob = new Blob(['bad'])
  const first = artworkPalette(blob), next = artworkPalette(new Blob(['next']))
  const staleError = FakeWorker.instances[0].onerror
  staleError?.()
  await expect(first).resolves.toEqual(amberPalette)
  expect(FakeWorker.instances).toHaveLength(2)
  staleError?.()
  expect(FakeWorker.instances[1].terminate).not.toHaveBeenCalled()
  vi.advanceTimersByTime(4000)
  await expect(next).resolves.toEqual(amberPalette)
  const retry = artworkPalette(blob)
  expect(FakeWorker.instances).toHaveLength(3)
  FakeWorker.instances[2].complete()
  await expect(retry).resolves.toEqual(amberPalette)
})
