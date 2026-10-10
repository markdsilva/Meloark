import { playlistPaths, playlistSession, type Library } from '../app/store'
import type { SearchPlaylistPreview, SearchReply, SearchRequest, SearchResults, SearchScope, SearchTrack } from './types'

const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0))
export class SearchClient {
  private worker: Worker
  private known = new Map<string, WeakRef<Library>>()
  private sequence = 0
  private disposed = false
  private failure?: Error
  private pending = new Map<number, { resolve: (reply: SearchReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private chain = Promise.resolve()
  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<SearchReply>) => {
      const request = this.pending.get(event.data.id)
      if (request) { clearTimeout(request.timer); if (event.data.type === 'error') request.reject(new Error(event.data.error)); else request.resolve(event.data) }
      this.pending.delete(event.data.id)
    }
    this.worker.onerror = () => {
      this.failure = new Error('Search could not start. Close it and try again.')
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(this.failure) }
      this.pending.clear()
    }
  }
  private post(message: SearchRequest) {
    if (this.disposed) return
    if (message.type === 'preview') this.worker.postMessage(message, [message.bytes.buffer])
    else this.worker.postMessage(message)
  }
  search(libraries: Library[], query: string, scope?: SearchScope): Promise<SearchResults> {
    const task = this.chain.then(async () => {
      if (this.disposed) throw new Error('Search closed.')
      if (this.failure) throw this.failure
      this.post({ type: 'remove', ids: libraries.map(library => library.id) })
      for (const library of libraries) {
        const old = this.known.get(library.id)?.deref()
        if (old?.tracks === library.tracks && old.sessions === library.sessions && old.playlists === library.playlists && old.hiddenPlaylists === library.hiddenPlaylists && old.name === library.name) continue
        const tracks: SearchTrack[] = []
        let count = 0
        for (const id in library.tracks) {
          const track = library.tracks[id]
          tracks.push({ id, title: track.metadata.title || track.filename, artist: track.metadata.artist, album: track.metadata.album, path: track.path })
          // Do not monopolize the UI thread while taking a large first snapshot.
          if (++count % 750 === 0) { await yieldToUI(); if (this.disposed) throw new Error('Search closed.') }
        }
        const playlists = playlistPaths(library).map(path => ({ id: path, path, name: playlistSession(library, path)?.name ?? path.split('/').at(-1)! }))
        this.post({ type: 'upsert', library: { id: library.id, name: library.name, tracks, playlists } })
        this.known.set(library.id, new WeakRef(library))
      }
      for (const id of this.known.keys()) if (!libraries.some(library => library.id === id)) this.known.delete(id)
    })
    this.chain = task.catch(() => undefined)
    return task.then(() => this.request({ type: 'query', id: ++this.sequence, query, scope })).then(reply => {
      if (reply.type !== 'results') throw new Error('Unexpected search response.')
      return reply.results
    })
  }
  preview(bytes: Uint8Array<ArrayBuffer>, path: string, tracks: [string, string][]): Promise<SearchPlaylistPreview> {
    return this.request({ type: 'preview', id: ++this.sequence, bytes, path, tracks }).then(reply => {
      if (reply.type !== 'preview') throw new Error('Unexpected playlist response.')
      return reply.preview
    })
  }
  private request(message: Extract<SearchRequest, { id: number }>): Promise<SearchReply> {
    return new Promise<SearchReply>((resolve, reject) => {
      if (this.disposed) { reject(new Error('Search closed.')); return }
      if (this.failure) { reject(this.failure); return }
      const id = message.id
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Search took too long. Close it and try again.')) }, 15_000)
      this.pending.set(id, { resolve, reject, timer })
      this.post(message)
    })
  }
  dispose() {
    this.disposed = true; this.worker.terminate()
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Search closed.')) }
    this.pending.clear(); this.known.clear()
  }
}
