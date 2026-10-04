import { describe, expect, it, vi } from 'vitest'
import { verifiedDelete, UnverifiedDeleteError } from '../../src/platform/filesystem/deleteProtocol'
import { ConflictError } from '../../src/platform/filesystem/saveProtocol'
const bytes = new Uint8Array([1, 2, 3])
describe('verified playlist deletion', () => {
  it.each(['song.mp3', 'folder', '../list.m3u8', '/list.m3u8', 'folder/../list.m3u8'])('never deletes %s', async path => {
    const remove = vi.fn()
    await expect(verifiedDelete(path, bytes, { read: async () => bytes, remove })).rejects.toThrow()
    expect(remove).not.toHaveBeenCalled()
  })
  it.each([null, new Uint8Array([9])])('refuses missing or changed files', async current => {
    const remove = vi.fn()
    await expect(verifiedDelete('List.m3u8', bytes, { read: async () => current, remove })).rejects.toBeInstanceOf(ConflictError)
    expect(remove).not.toHaveBeenCalled()
  })
  it('refuses oversized versions without mutation', async () => {
    const remove = vi.fn()
    await expect(verifiedDelete('List.m3u8', new Uint8Array(16 * 1024 * 1024 + 1), { read: async () => bytes, remove })).rejects.toThrow('inspection limit')
    expect(remove).not.toHaveBeenCalled()
  })
  it.each(['remove', 'readback', 'still exists'])('does not commit %s failure', async failure => {
    let reads = 0
    await expect(verifiedDelete('List.m3u8', bytes, {
      read: async () => { if (++reads > 1 && failure === 'readback') throw new Error('Permission lost'); return bytes },
      remove: async () => { if (failure === 'remove') throw new Error('Permission denied') },
    })).rejects.toBeInstanceOf(UnverifiedDeleteError)
  })
  it.each(['List.m3u', 'nested/List.m3u8'])('returns a receipt only after verifying absence: %s', async path => {
    let disk: Uint8Array | null = bytes
    const receipt = await verifiedDelete(path, bytes, { read: async () => disk, remove: async () => { disk = null } })
    expect(receipt).toEqual({ path, deleted: true })
  })
})
