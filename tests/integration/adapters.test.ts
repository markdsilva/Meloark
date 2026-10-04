import { describe, it, expect, vi } from 'vitest'
import { PortableSource } from '../../src/platform/filesystem/portable'
import { DirectSource } from '../../src/platform/filesystem/direct'
import type { DirectoryHandle } from '../../src/platform/filesystem/types'
import { File as NodeFile } from 'node:buffer'
const file = (name: string, relative: string) => {
  const file = new File(['audio'], name)
  Object.defineProperty(file, 'webkitRelativePath', { value: relative })
  return file
}
describe('portable adapter', () => {
  it('strips the chosen root once and retains nested folders', async () => {
    const selected = file('a.mp3', 'Music/Album/a.mp3')
    const source = new PortableSource([selected])
    const result = []
    for await (const entry of source.scan(new AbortController().signal)) result.push(entry)
    expect(result[0].path).toBe('Album/a.mp3')
    expect(await source.readFile('Album/a.mp3')).toBe(selected)
    expect((await source.getAccess()).write).toBe('denied')
    await expect(source.writePlaylist()).rejects.toThrow('Export')
  })
  it('cancels scanning and rejects ambiguous loose-file names', async () => {
    const source = new PortableSource([file('a.mp3', '')]), controller = new AbortController()
    controller.abort()
    await expect(source.scan(controller.signal)[Symbol.asyncIterator]().next()).rejects.toThrow()
    expect(() => new PortableSource([file('a.mp3', ''), file('a.mp3', '')])).toThrow('same relative path')
  })
})
describe('direct adapter boundaries', () => {
  it('deletes only a verified playlist file without recursive removal', async () => {
    let disk: File | undefined = new NodeFile(['#EXTM3U\n'], 'List.m3u8') as unknown as File
    const expected = new Uint8Array(await disk.arrayBuffer())
    const root = { name: 'Music', queryPermission: vi.fn(async () => 'granted'), removeEntry: vi.fn(async () => { disk = undefined }),
      getFileHandle: vi.fn(async () => { if (!disk) throw new DOMException('Missing', 'NotFoundError'); return { getFile: async () => disk! } }),
    } as unknown as DirectoryHandle
    const source = new DirectSource(root)
    expect(await source.deletePlaylist('List.m3u8', expected)).toEqual({ path: 'List.m3u8', deleted: true })
    expect(root.removeEntry).toHaveBeenCalledWith('List.m3u8', { recursive: false })
  })
  it('rejects deletion permissions and playlist-named directories before removal', async () => {
    const root = { name: 'Music', queryPermission: vi.fn(async () => 'denied'), removeEntry: vi.fn(), getFileHandle: vi.fn(async () => { throw new DOMException('Directory', 'TypeMismatchError') }) } as unknown as DirectoryHandle
    const source = new DirectSource(root)
    await expect(source.deletePlaylist('List.m3u8', new Uint8Array())).rejects.toThrow('permission')
    expect(root.getFileHandle).not.toHaveBeenCalled()
    root.queryPermission = async () => 'granted'
    await expect(source.deletePlaylist('List.m3u8', new Uint8Array())).rejects.toThrow('Directory')
    expect(root.removeEntry).not.toHaveBeenCalled()
  })
  it('discovers nested folders and propagates unreadable-file failures', async () => {
    const handle = { kind: 'file', getFile: async () => ({ size: 10, lastModified: 12 }) }
    const album = { kind: 'directory', entries: async function* () { yield ['A.mp3', handle] } }
    const root = { name: 'Music', entries: async function* () { yield ['Album', album] } } as unknown as DirectoryHandle
    const source = new DirectSource(root), files = []
    for await (const item of source.scan(new AbortController().signal)) files.push(item)
    expect(files[0].path).toBe('Album/A.mp3')
    handle.getFile = async () => { throw new DOMException('File no longer available', 'NotFoundError') }
    await expect(source.readFile('Album/A.mp3')).rejects.toThrow('no longer available')
  })
  it('requests permission only from the explicit access method', async () => {
    const root = { name: 'Music', queryPermission: vi.fn(async () => 'prompt'), requestPermission: vi.fn(async () => 'granted') } as unknown as DirectoryHandle
    const source = new DirectSource(root)
    expect((await source.getAccess()).reconnect).toBe(true)
    expect(root.requestPermission).not.toHaveBeenCalled()
    expect(await source.requestAccess('write')).toBe(true)
    expect(root.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
  })
  it('never obtains a file handle to mutate audio or an escaped path', async () => {
    const root = { name: 'Music', getFileHandle: vi.fn() } as unknown as DirectoryHandle
    const source = new DirectSource(root)
    for (const path of ['song.mp3', '../x.m3u8', '/x.m3u8']) await expect(source.writePlaylist(path, new Uint8Array(), null)).rejects.toThrow()
    expect(root.getFileHandle).not.toHaveBeenCalled()
    expect(source).not.toHaveProperty('deleteFile')
    expect(source).not.toHaveProperty('renameFile')
  })
})
