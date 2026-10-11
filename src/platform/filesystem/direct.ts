import { normalizeRelative } from '../../playlists/paths'
import { equalBytes, verifiedWrite, verifiedSyncWrite } from './saveProtocol'
import { validatePlaylistDeletion, verifiedDelete } from './deleteProtocol'
import { MAX_BYTES } from '../../playlists/codec'
import type { DirectoryHandle, FileDescriptor, LibrarySource } from './types'
import { JOURNAL_PATH } from '../../domain/orderSync'
import { dirname, newId } from '../../domain/models'
import { reportFileAccessError, reportFileAccessLoss } from './accessEvents'

type MovableHandle = FileSystemFileHandle & { move?: (name: string) => Promise<void> }

export class DirectSource implements LibrarySource {
  readonly kind = 'direct' as const
  readonly name: string
  get canDeletePlaylists() { return typeof this.root.removeEntry === 'function' }
  private handles = new Map<string, FileSystemFileHandle>()
  constructor(readonly root: DirectoryHandle) { this.name = root.name }
  private async access<T>(intent: 'read' | 'write', action: () => Promise<T>): Promise<T> {
    try { return await action() }
    catch (error) { reportFileAccessError(this, error, intent); throw error }
  }
  async *scan(signal: AbortSignal): AsyncIterable<FileDescriptor> {
    const root = this.root
    const handles = new Map<string, FileSystemFileHandle>()
    async function* walk(directory: DirectoryHandle, prefix = ''): AsyncIterable<FileDescriptor> {
      for await (const [name, handle] of directory.entries()) {
        signal.throwIfAborted()
        if (name === JOURNAL_PATH) {
          if (prefix) throw new Error(`Interrupted filename sync in ${prefix}. Reconnect that folder as its original library and recover it first.`)
          continue
        }
        if (name.startsWith('.meloark-probe-')) continue
        const path = prefix ? `${prefix}/${name}` : name
        if (handle.kind === 'directory') yield* walk(handle as DirectoryHandle, path)
        else {
          const file = await handle.getFile()
          handles.set(path, handle)
          yield { reference: path, path, size: file.size, lastModified: file.lastModified }
        }
      }
    }
    try { yield* walk(root) }
    catch (error) { reportFileAccessError(this, error, 'read'); throw error }
    finally { this.handles = handles }
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
    try {
      const cached = this.handles.get(reference)
      if (cached) return await cached.getFile()
      const { directory, name } = await this.parent(reference)
      const handle = await directory.getFileHandle(name)
      this.handles.set(reference, handle)
      return await handle.getFile()
    } catch (error) { reportFileAccessError(this, error, 'read'); throw error }
  }
  async getAccess() {
    const read = await this.access('read', () => this.root.queryPermission({ mode: 'read' }))
    if (read !== 'granted') reportFileAccessLoss(this, 'read')
    const write = await this.access('write', () => this.root.queryPermission({ mode: 'readwrite' }))
    return { read, write, reconnect: read !== 'granted' }
  }
  async requestAccess(intent: 'read' | 'write') {
    const mode = intent === 'write' ? 'readwrite' : 'read'
    try {
      if (await this.root.queryPermission({ mode }) === 'granted') return true
      const granted = await this.root.requestPermission({ mode }) === 'granted'
      if (!granted) reportFileAccessLoss(this, intent)
      return granted
    } catch (error) { reportFileAccessError(this, error, intent); throw error }
  }
  async writePlaylist(path: string, bytes: Uint8Array, expected: Uint8Array | null) {
    if (!path.toLowerCase().endsWith('.m3u8') || normalizeRelative(path) !== path) throw new Error('Only library-relative M3U8 files can be written.')
    return this.writeChecked(path, bytes, expected)
  }
  async writeSyncFile(path: string, bytes: Uint8Array, expected: Uint8Array | null) {
    if (path !== JOURNAL_PATH && !/\.m3u8?$/i.test(path)) throw new Error('Sync writes are limited to playlist references and the recovery journal.')
    if (normalizeRelative(path) !== path) throw new Error('Unsafe sync path.')
    return this.writeChecked(path, bytes, expected, true)
  }
  private async writeChecked(path: string, bytes: Uint8Array, expected: Uint8Array | null, sync = false) {
    if ((await this.getAccess()).write !== 'granted') {
      reportFileAccessLoss(this, 'write')
      throw new DOMException('Write permission is required.', 'NotAllowedError')
    }
    const { directory, name } = await this.access('read', () => this.parent(path))
    const read = async () => {
      try {
        const file = await (await directory.getFileHandle(name)).getFile()
        if (file.size > (path === JOURNAL_PATH ? 64 * 1024 * 1024 : MAX_BYTES)) throw new Error('The target is too large to inspect safely. It was not overwritten.')
        return new Uint8Array(await file.arrayBuffer())
      }
      catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; reportFileAccessError(this, error, 'read'); throw error }
    }
    try { return await (sync ? verifiedSyncWrite : verifiedWrite)(path, bytes, expected, {
      read,
      open: () => this.access('write', async () => {
        const handle = await directory.getFileHandle(name, { create: true })
        this.handles.set(path, handle)
        const stream = await handle.createWritable()
        return { write: data => this.access('write', () => stream.write(new Uint8Array(data).buffer)), close: () => this.access('write', () => stream.close()), abort: () => this.access('write', () => stream.abort()) }
      }),
    }) } catch (error) { reportFileAccessError(this, error, 'write'); throw error }
  }
  async readFresh(path: string): Promise<File | null> {
    try {
      const { directory, name } = await this.parent(path)
      return await (await directory.getFileHandle(name)).getFile()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null
      reportFileAccessError(this, error, 'read'); throw error
    }
  }
  async moveFile(source: string, target: string) {
    if (dirname(source) !== dirname(target)) throw new Error('Sync can only rename files within the same folder.')
    if ((await this.getAccess()).write !== 'granted') {
      reportFileAccessLoss(this, 'write'); throw new DOMException('Write permission is required.', 'NotAllowedError')
    }
    const { directory, name } = await this.parent(source), destination = await this.parent(target)
    if (await this.readFresh(target)) throw new Error(`A target already exists: ${target}. Nothing was overwritten.`)
    const handle = await directory.getFileHandle(name) as MovableHandle
    if (typeof handle.move !== 'function') throw new Error('Native file rename is unavailable in this browser. Use M3U8-only mode.')
    try { await handle.move(destination.name) }
    catch (error) { reportFileAccessError(this, error, 'write'); throw error }
    // Cached handles follow the native entry even during a two-phase rename.
    this.handles.set(source, handle)
  }
  resetHandles() { this.handles.clear() }
  async removeJournal(expected: Uint8Array) {
    const file = await this.readFresh(JOURNAL_PATH)
    if (!file) return
    if (!equalBytes(new Uint8Array(await file.arrayBuffer()), expected)) throw new Error('The recovery journal changed. It was preserved.')
    await this.access('write', () => this.root.removeEntry(JOURNAL_PATH))
    if (await this.readFresh(JOURNAL_PATH)) throw new Error('Recovery journal removal could not be verified.')
  }
  async probeRename(folder: string) {
    if (!await this.requestAccess('write')) throw new Error('Write access was not granted. M3U8-only mode is still available.')
    const token = newId(), name = `.meloark-probe-${token}`, path = folder ? `${folder}/${name}` : name
    const { directory } = await this.parent(path)
    if (await this.readFresh(path) || await this.readFresh(`${path}-renamed`)) throw new Error('The disposable capability test name is occupied.')
    const handle = await directory.getFileHandle(name, { create: true }) as MovableHandle
    const bytes = new TextEncoder().encode(`Meloark rename probe ${token}`)
    let current = name, cleanupError: unknown
    try {
      const stream = await handle.createWritable(); await stream.write(new Uint8Array(bytes).buffer); await stream.close()
      if (typeof handle.move !== 'function') throw new Error('This browser does not provide native file renaming. Use M3U8-only mode.')
      await handle.move(`${name}-renamed`); current = `${name}-renamed`
      const moved = await (await directory.getFileHandle(current)).getFile()
      if (await moved.text() !== new TextDecoder().decode(bytes)) throw new Error('The native rename probe could not be verified.')
      await handle.move(name); current = name
    } finally {
      // Delete only this probe, and only after verifying our exact payload.
      for (const candidate of new Set([current, name, `${name}-renamed`])) {
        try { const file = await (await directory.getFileHandle(candidate)).getFile(); if (await file.text() === new TextDecoder().decode(bytes)) await directory.removeEntry(candidate) }
        catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) cleanupError = error }
      }
    }
    if (cleanupError) throw cleanupError
  }
  async deletePlaylist(path: string, expected: Uint8Array) {
    validatePlaylistDeletion(path)
    if ((await this.getAccess()).write !== 'granted') {
      reportFileAccessLoss(this, 'write'); throw new DOMException('Write permission is required to delete a playlist file.', 'NotAllowedError')
    }
    const { directory, name } = await this.parent(path)
    if (typeof directory.removeEntry !== 'function') throw new Error('Playlist file deletion is unavailable. Use your file manager instead.')
    const read = async () => {
      try {
        // getFileHandle also rejects directories; removal never recursively traverses them.
        const file = await (await directory.getFileHandle(name)).getFile()
        if (file.size > MAX_BYTES) throw new Error('This playlist exceeds the inspection limit. Use your file manager instead.')
        return new Uint8Array(await file.arrayBuffer())
      } catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error }
    }
    let receipt
    try { receipt = await verifiedDelete(path, expected, { read, remove: () => this.access('write', () => directory.removeEntry(name, { recursive: false })) }) }
    catch (error) { reportFileAccessError(this, error, 'write'); throw error }
    this.handles.delete(path)
    return receipt
  }
}
