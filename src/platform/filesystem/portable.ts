import { normalizeRelative } from '../../playlists/paths'
import type { LibrarySource, FileDescriptor } from './types'

export class PortableSource implements LibrarySource {
  readonly kind = 'portable' as const
  readonly name: string
  private files = new Map<string, File>()
  constructor(files: File[]) {
    this.name = files[0]?.webkitRelativePath?.split('/')[0] || 'Selected files'
    for (const file of files) {
      const raw = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name
      const path = normalizeRelative(raw)
      if (!path || path !== raw) throw new Error('A selected file has an unsafe relative path.')
      if (this.files.has(path)) throw new Error(`Multiple selected files have the same relative path: ${path}. Select their parent folder instead.`)
      this.files.set(path, file)
    }
  }
  async *scan(signal: AbortSignal): AsyncIterable<FileDescriptor> {
    let count = 0
    for (const [path, file] of this.files) {
      signal.throwIfAborted()
      yield { reference: path, path, size: file.size, lastModified: file.lastModified }
      if (++count % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  async readFile(reference: string) {
    const file = this.files.get(reference)
    if (!file) throw new Error('Reselect the library to access this file.')
    return file
  }
  async getAccess() { return { read: 'granted' as const, write: 'denied' as const, reconnect: false } }
  async requestAccess(intent: 'read' | 'write') { return intent === 'read' }
  async writePlaylist(): Promise<never> { throw new Error('Direct writing is unavailable. Export the playlist instead.') }
}
