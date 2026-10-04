import { create } from 'zustand'
import type { BitrateSample } from './bitrateReader'

interface LiveState { key: string; status: 'idle' | 'analyzing' | 'ready' | 'unavailable'; sample?: BitrateSample; reason?: string }
export const useLiveBitrate = create<LiveState>(() => ({ key: '', status: 'idle' }))

class LiveBitrateController {
  private file?: File
  private worker?: Worker
  private timer?: ReturnType<typeof setInterval>
  private watchdog?: ReturnType<typeof setTimeout>
  private consumers = 0
  private sequence = 0
  private pending = false
  private position = 0
  private playing = false
  private failed = false
  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.update())
  }
  register(file?: File, key = '') {
    this.disposeWorker(); this.file = file; this.failed = false; this.position = 0
    useLiveBitrate.setState({ key, status: 'idle', sample: undefined, reason: undefined })
    this.update()
  }
  visible() { this.consumers++; this.update(); return () => { this.consumers = Math.max(0, this.consumers - 1); this.update() } }
  observe(position: number, playing: boolean) { this.position = position; this.playing = playing; this.update() }
  seek(position: number) {
    this.position = position; this.disposeWorker()
    if (!this.failed) useLiveBitrate.setState({ status: 'analyzing', sample: undefined })
    this.update()
  }
  private update() {
    const active = this.file && this.consumers > 0 && this.playing && !document.hidden && !this.failed
    if (active && !this.timer) { this.timer = setInterval(() => this.request(), 250); this.request() }
    else if (!active) {
      clearInterval(this.timer); this.timer = undefined
      if (this.pending) this.disposeWorker()
      if (!this.file || !this.consumers || document.hidden) this.disposeWorker()
    }
  }
  private disposeWorker() {
    this.sequence++; clearTimeout(this.watchdog); this.watchdog = undefined
    this.worker?.terminate(); this.worker = undefined; this.pending = false
  }
  private fail(reason: string) {
    this.failed = true; this.disposeWorker()
    useLiveBitrate.setState({ status: 'unavailable', reason, sample: undefined }); this.update()
  }
  private request() {
    if (this.pending || !this.file) return
    if (typeof Worker === 'undefined') { this.fail('Live analysis requires Web Worker support.'); return }
    try {
      const opening = !this.worker
      this.worker ??= new Worker(new URL('./bitrate.worker.ts', import.meta.url), { type: 'module' })
      const id = ++this.sequence, key = useLiveBitrate.getState().key
      this.pending = true
      if (!useLiveBitrate.getState().sample) useLiveBitrate.setState({ status: 'analyzing' })
      this.worker.onmessage = event => {
        if (id !== this.sequence || event.data.id !== id || event.data.key !== key || useLiveBitrate.getState().key !== key) return
        this.pending = false; clearTimeout(this.watchdog)
        if (event.data.error) this.fail(event.data.error)
        else if (Number.isFinite(event.data.sample?.bitrate) && event.data.sample.bitrate > 0) useLiveBitrate.setState({ status: 'ready', sample: event.data.sample, reason: undefined })
        else this.fail('Reliable source bitrate is unavailable.')
      }
      this.worker.onerror = () => { if (id === this.sequence) this.fail('The live analysis worker failed. Playback is unaffected.') }
      this.watchdog = setTimeout(() => this.fail('Live analysis took too long for this file or seek. Static details remain available.'), 5000)
      this.worker.postMessage({ id, key, file: opening ? this.file : undefined, position: this.position })
    } catch { this.fail('Live analysis could not start. Static details remain available.') }
  }
}
export const liveBitrate = new LiveBitrateController()
