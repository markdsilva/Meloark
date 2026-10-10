export interface QueueItem { id: string; trackId?: string }
export type QueueContext = { kind: 'library' | 'search'; libraryId: string } | { kind: 'playlist'; libraryId: string; sessionId: string }
export type Repeat = 'off' | 'all' | 'one'
export class PlaybackQueue {
  entries: QueueItem[] = []
  current: string | null = null
  shuffle = false
  repeat: Repeat = 'off'
  unavailable = new Set<string>()
  history: string[] = []
  future: string[] = []
  constructor(private random = Math.random) {}
  private randomized(ids: string[]) {
    const copy = [...ids]
    for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]] }
    return copy
  }
  setShuffle(enabled: boolean) {
    this.shuffle = enabled
    this.history = []
    this.future = this.randomized(this.entries.filter(e => e.id !== this.current && !this.unavailable.has(e.id)).map(e => e.id))
  }
  reconcile(entries: QueueItem[]): string | null {
    const oldIndex = this.entries.findIndex(e => e.id === this.current)
    const ids = new Set(entries.map(e => e.id))
    const successor = this.entries.slice(oldIndex + 1).find(e => ids.has(e.id))?.id ?? null
    this.entries = entries
    this.history = this.history.filter(id => ids.has(id))
    this.unavailable = new Set([...this.unavailable].filter(id => ids.has(id)))
    this.future = this.future.filter(id => ids.has(id))
    if (this.current && !ids.has(this.current)) this.current = successor
    const seen = new Set([...this.history, ...this.future, ...(this.current ? [this.current] : [])])
    this.future.push(...this.randomized(entries.filter(e => !seen.has(e.id)).map(e => e.id)))
    return this.current
  }
  start(id: string) { this.current = id; this.setShuffle(this.shuffle) }
  next(natural = false): string | null {
    if (!this.current) return null
    if (natural && this.repeat === 'one' && !this.unavailable.has(this.current)) return this.current
    let candidate: string | undefined
    if (this.shuffle) {
      candidate = this.future.find(id => !this.unavailable.has(id))
      if (!candidate && this.repeat === 'all') {
        this.future = this.randomized(this.entries.filter(e => !this.unavailable.has(e.id) && e.id !== this.current).map(e => e.id))
        candidate = this.future[0] ?? (!this.unavailable.has(this.current) ? this.current : undefined)
      }
    } else {
      const position = this.entries.findIndex(e => e.id === this.current)
      candidate = this.entries.slice(position + 1).find(e => !this.unavailable.has(e.id))?.id
      if (!candidate && this.repeat === 'all') candidate = this.entries.find(e => !this.unavailable.has(e.id))?.id
    }
    if (!candidate) return null
    if (candidate !== this.current) {
      this.history = [...this.history, this.current].slice(-this.entries.length)
      this.future = this.future.filter(id => id !== candidate)
      this.current = candidate
    }
    return candidate
  }
  previous(): string | null {
    if (this.shuffle) {
      let previous = this.history.pop()
      while (previous && this.unavailable.has(previous)) previous = this.history.pop()
      if (!previous) return null
      if (this.current) this.future.unshift(this.current)
      this.current = previous
      return previous
    }
    const index = this.entries.findIndex(e => e.id === this.current)
    const entry = this.entries.slice(0, index).reverse().find(e => !this.unavailable.has(e.id))
    const previous = entry ?? (this.repeat === 'all' ? [...this.entries].reverse().find(e => !this.unavailable.has(e.id)) : undefined)
    this.current = previous?.id ?? this.current
    return previous?.id ?? null
  }
}
