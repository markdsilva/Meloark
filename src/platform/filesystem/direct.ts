import { normalizeRelative } from '../../playlists/paths'
import { verifiedWrite } from './saveProtocol'
import { MAX_BYTES } from '../../playlists/codec'
import type { DirectoryHandle, FileDescriptor, LibrarySource } from './types'

export class DirectSource implements LibrarySource {
  readonly kind = 'direct' as const
  readonly name: string
  private handles = new Map<string, FileSystemFileHandle>()
  constructor(readonly root: DirectoryHandle) { this.name = root.name }
  async *scan(signal: AbortSignal): AsyncIterable<FileDescriptor> {
    const root = this.root
    const handles = new Map<string, FileSystemFileHandle>()
    async function* walk(directory: DirectoryHandle, prefix = ''): AsyncIterable<FileDescriptor> {
      for await (const [name, handle] of directory.entries()) {
        signal.throwIfAborted()
        const path = prefix ? `${prefix}/${name}` : name
        if (handle.kind === 'directory') yield* walk(handle as DirectoryHandle, path)
        else {
          const file = await handle.getFile()
          handles.set(path, handle)
          yield { reference: path, path, size: file.size, lastModified: file.lastModified }
        }
      }
    }
    try { yield* walk(root) } finally { this.handles = handles }
  }
  private async parent(path: string): Promise<{ directory: DirectoryHandle; name: string }> {
    if (normalizeRelative(path) !== path) throw new Error('Unsafe library-relative path.')
    const parts = path.split('/'), name = parts.pop()!
    let directory = this.root
    for (const part of parts) directory = await directory.getDirectoryHandle(part) as DirectoryHandle
    return { directory, name }
  }
  async readFile(reference: string): Promise<File> {
    if (normalizeRelative(reference) !== reference) throw new Error('Unsafe file reference.')
    const cached = this.handles.get(reference)
    if (cached) return cached.getFile()
    const { directory, name } = await this.parent(reference)
    const handle = await directory.getFileHandle(name)
    this.handles.set(reference, handle)
    return handle.getFile()
  }
  async getAccess() {
    const read = await this.root.queryPermission({ mode: 'read' })
    const write = await this.root.queryPermission({ mode: 'readwrite' })
    return { read, write, reconnect: read !== 'granted' }
  }
  async requestAccess(intent: 'read' | 'write') {
    const mode = intent === 'write' ? 'readwrite' : 'read'
    if (await this.root.queryPermission({ mode }) === 'granted') return true
    return await this.root.requestPermission({ mode }) === 'granted'
  }
  async writePlaylist(path: string, bytes: Uint8Array, expected: Uint8Array | null) {
    if (!path.toLowerCase().endsWith('.m3u8') || normalizeRelative(path) !== path) throw new Error('Only library-relative M3U8 files can be written.')
    if ((await this.getAccess()).write !== 'granted') throw new Error('Write permission is required.')
    const { directory, name } = await this.parent(path)
    const read = async () => {
      try {
        const file = await (await directory.getFileHandle(name)).getFile()
        if (file.size > MAX_BYTES) throw new Error('The target is too large to inspect safely. It was not overwritten.')
        return new Uint8Array(await file.arrayBuffer())
      }
      catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error }
    }
    return verifiedWrite(path, bytes, expected, {
      read,
      open: async () => {
        const handle = await directory.getFileHandle(name, { create: true })
        this.handles.set(path, handle)
        const stream = await handle.createWritable()
        return { write: data => stream.write(new Uint8Array(data).buffer), close: () => stream.close(), abort: () => stream.abort() }
      },
    })
  }
}
