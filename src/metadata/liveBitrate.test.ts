import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveBitrate, useLiveBitrate } from './liveBitrate'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage?: (event: { data: unknown }) => void
  onerror?: () => void
  messages: { id: number; key: string; position: number; file?: File }[] = []
  terminated = false
  constructor() { FakeWorker.instances.push(this) }
  postMessage(message: FakeWorker['messages'][number]) { this.messages.push(message) }
  terminate() { this.terminated = true }
  reply() { const message = this.messages.at(-1)!; this.onmessage?.({ data: { ...message, sample: { bitrate: 128000, kind: 'live', start: 0, end: 1 } } }) }
}
let release: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker); FakeWorker.instances = []
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  liveBitrate.observe(0, false); liveBitrate.register()
})
afterEach(() => { release?.(); release = undefined; liveBitrate.observe(0, false); liveBitrate.register(); vi.useRealTimers(); vi.unstubAllGlobals() })
function start() { liveBitrate.register(new File(['local'], 'Song.mp3'), 'song'); release = liveBitrate.visible(); liveBitrate.observe(0, true) }
describe('live analysis lifecycle', () => {
  it('runs only for a visible, playing track and keeps one request in flight', () => {
    liveBitrate.register(new File(['local'], 'Song.mp3'), 'song'); liveBitrate.observe(0, true)
    expect(FakeWorker.instances).toHaveLength(0)
    release = liveBitrate.visible()
    const worker = FakeWorker.instances[0]; vi.advanceTimersByTime(1000)
    expect(worker.messages).toHaveLength(1)
    worker.reply(); expect(useLiveBitrate.getState().status).toBe('ready')
    vi.advanceTimersByTime(250); expect(worker.messages).toHaveLength(2)
    expect(worker.messages[1].file).toBeUndefined()
    liveBitrate.observe(1, false); expect(worker.terminated).toBe(true)
    vi.advanceTimersByTime(1000); expect(FakeWorker.instances).toHaveLength(1)
  })
  it('clears metrics after seeking and ignores a terminated worker’s stale response', () => {
    start(); const old = FakeWorker.instances[0]; old.reply()
    liveBitrate.seek(50); expect(useLiveBitrate.getState().sample).toBeUndefined()
    old.reply(); expect(useLiveBitrate.getState().status).toBe('analyzing')
    vi.advanceTimersByTime(250); expect(FakeWorker.instances[1].messages[0].position).toBe(50)
    liveBitrate.register(new File(['other'], 'Other.mp3'), 'other'); old.reply()
    expect(useLiveBitrate.getState().key).toBe('other'); expect(useLiveBitrate.getState().sample).toBeUndefined()
  })
  it('terminates analysis while hidden and resumes when visible', () => {
    start(); const worker = FakeWorker.instances[0]
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'))
    expect(worker.terminated).toBe(true); vi.advanceTimersByTime(1000); expect(FakeWorker.instances).toHaveLength(1)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWorker.instances).toHaveLength(2)
  })
  it('times out safely and does not retry a failed track indefinitely', () => {
    start(); vi.advanceTimersByTime(5000)
    expect(useLiveBitrate.getState().status).toBe('unavailable'); expect(useLiveBitrate.getState().reason).toMatch(/too long/)
    vi.advanceTimersByTime(10000); expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0].terminated).toBe(true)
  })
})
