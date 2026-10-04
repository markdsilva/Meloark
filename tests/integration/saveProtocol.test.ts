import { describe, it, expect, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { ConflictError, UnverifiedWriteError, verifiedWrite, type SaveTarget } from '../../src/platform/filesystem/saveProtocol'
const before = new Uint8Array([1]), after = new Uint8Array([2])
function target(failure?: 'open' | 'write' | 'close' | 'verify') {
  let disk: Uint8Array = before, staged: Uint8Array = before, reads = 0
  const abort = vi.fn(async () => {})
  const adapter: SaveTarget = {
    read: vi.fn(async () => { if (++reads > 1 && failure === 'verify') throw new Error('read denied'); return disk }),
    open: vi.fn(async () => {
      if (failure === 'open') throw new Error('permission denied')
      return { write: async (bytes: Uint8Array) => { if (failure === 'write') throw new Error('write failed'); staged = bytes },
        close: async () => { if (failure === 'close') throw new Error('close failed'); disk = staged }, abort }
    }),
  }
  return { adapter, abort, disk: () => disk }
}
describe('verified single-file saving', () => {
  it('checks expected bytes before opening a writer', async () => {
    const t = target()
    await expect(verifiedWrite('list.m3u8', after, null, t.adapter)).rejects.toBeInstanceOf(ConflictError)
    expect(t.adapter.open).not.toHaveBeenCalled()
  })
  it.each(['open', 'write', 'close', 'verify'] as const)('does not return a receipt on %s failure', async failure => {
    const t = target(failure)
    const result = verifiedWrite('list.m3u8', after, before, t.adapter)
    await expect(result).rejects.toThrow()
    if (failure === 'write' || failure === 'close') expect(t.abort).toHaveBeenCalled()
    if (failure !== 'verify') expect(t.disk()).toEqual(before)
  })
  it('marks verification failure as uncertain rather than pretending rollback', async () => {
    const t = target('verify')
    await expect(verifiedWrite('list.m3u8', after, before, t.adapter)).rejects.toBeInstanceOf(UnverifiedWriteError)
    expect(t.disk()).toEqual(after)
  })
  it('returns a receipt only after close and read-back', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const t = target()
    const receipt = await verifiedWrite('list.m3u8', after, before, t.adapter)
    expect(receipt.bytes).toEqual(after)
    expect(receipt.hash).toHaveLength(64)
    vi.unstubAllGlobals()
  })
  it('safely creates a missing target and verifies it', async () => {
    vi.stubGlobal('crypto', webcrypto)
    let disk: Uint8Array | null = null, staged: Uint8Array | null = null
    const receipt = await verifiedWrite('New.m3u8', after, null, {
      read: async () => disk,
      open: async () => ({ write: async bytes => { staged = bytes }, close: async () => { disk = staged }, abort: async () => {} }),
    })
    expect(receipt.bytes).toEqual(after)
    expect(disk).toEqual(after)
    vi.unstubAllGlobals()
  })
  it.each(['track.mp3', '../list.m3u8', '/list.m3u8'])('never opens a writer for %s', async path => {
    const t = target()
    await expect(verifiedWrite(path, after, before, t.adapter)).rejects.toThrow()
    expect(t.adapter.open).not.toHaveBeenCalled()
  })
})
