import { beforeEach, describe, expect, it, vi } from 'vitest'
import { File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { JOURNAL_PATH } from '../../src/domain/orderSync'
import { equalBytes } from '../../src/platform/filesystem/saveProtocol'
import { executeJournal, fingerprint, journalBytes, parseJournal, prepareJournal, readJournal, type SyncDisk, type SyncJournal } from '../../src/platform/filesystem/orderSyncProtocol'

function fixture() {
  const files = new Map<string, File>([
    ['01 - Same.wav', new NativeFile(['first audio'], '01 - Same.wav', { lastModified: 10 }) as unknown as File],
    ['02 - Same.wav', new NativeFile(['second audio'], '02 - Same.wav', { lastModified: 20 }) as unknown as File],
    ['List.m3u8', new NativeFile(['#EXTM3U\n01 - Same.wav\n02 - Same.wav\n'], 'List.m3u8') as unknown as File],
  ])
  let operation = 0, failAt = -1, after = false
  const step = (done: boolean) => { if (!done) operation++; if (operation === failAt && done === after) throw new Error('Injected interruption') }
  const disk: SyncDisk = {
    readFresh: async path => files.get(path) ?? null,
    moveFile: async (from, to) => { step(false); if (!files.has(from) || files.has(to)) throw new Error('Unsafe move'); files.set(to, files.get(from)!); files.delete(from); step(true) },
    writeSyncFile: async (path, bytes, expected) => {
      step(false); const actual = files.get(path), current = actual ? new Uint8Array(await actual.arrayBuffer()) : null
      if (current ? !equalBytes(current, expected) : expected !== null) throw new Error('Conflict')
      files.set(path, new NativeFile([new Uint8Array(bytes)], path) as unknown as File); step(true)
    },
  }
  const make = () => prepareJournal(disk, { version: 1, token: 'test', libraryId: 'lib', sessionId: 'session', revision: 1, folder: '', order: ['b', 'a'],
    moves: [{ source: '01 - Same.wav', temporary: '.meloark-test-0.wav', target: '02 - Same.wav', trackId: 'a' }, { source: '02 - Same.wav', temporary: '.meloark-test-1.wav', target: '01 - Same.wav', trackId: 'b' }],
    patches: [{ path: 'List.m3u8', before: [...new TextEncoder().encode('#EXTM3U\n01 - Same.wav\n02 - Same.wav\n')], after: [...new TextEncoder().encode('#EXTM3U\n02 - Same.wav\n01 - Same.wav\n')] }],
  })
  return { files, disk, make, interrupt: (at: number, effect: boolean) => { operation = 0; failAt = at; after = effect }, reset: () => { failAt = -1 } }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
describe('recoverable native rename protocol', () => {
  it('accepts native timestamp changes while verifying all audio bytes', async () => {
    const t = fixture(), journal = await t.make()
    t.disk.moveFile = async (from, to) => {
      const file = t.files.get(from)!
      t.files.set(to, new NativeFile([await file.arrayBuffer()], to, { lastModified: Date.now() }) as unknown as File)
      t.files.delete(from)
    }
    await executeJournal(t.disk, journal, null, async () => {})
    expect(await t.files.get('01 - Same.wav')!.text()).toBe('second audio')
    expect(await t.files.get('02 - Same.wav')!.text()).toBe('first audio')
  })
  it('detects changed middle bytes even if size and modification time are preserved', async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024)
    const before = new NativeFile([bytes], 'large.flac', { lastModified: 10 }) as unknown as File
    bytes[bytes.length / 2] = 1
    const after = new NativeFile([bytes], 'large.flac', { lastModified: 10 }) as unknown as File
    expect(await fingerprint(after)).not.toBe(await fingerprint(before))
  })
  it('recovers an older journal after a staged native rename changed its timestamp', async () => {
    const t = fixture(), journal = await t.make()
    for (const move of journal.moves) {
      const file = t.files.get(move.source)!
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { hashBytes } = await import('../../src/platform/filesystem/saveProtocol')
      move.fingerprint = `${file.size}:${file.lastModified}:${await hashBytes(bytes)}`
    }
    const first = journal.moves[0], file = t.files.get(first.source)!
    t.files.set(first.temporary, new NativeFile([await file.arrayBuffer()], first.temporary, { lastModified: 999 }) as unknown as File)
    t.files.delete(first.source)
    const bytes = journalBytes(journal)
    t.files.set(JOURNAL_PATH, new NativeFile([bytes], JOURNAL_PATH) as unknown as File)
    await executeJournal(t.disk, journal, bytes, async () => {})
    expect(await t.files.get('02 - Same.wav')!.text()).toBe('first audio')
  })
  it('keeps recovery data if native rename changed content', async () => {
    const t = fixture(), journal = await t.make()
    t.disk.moveFile = async (from, to) => {
      t.files.set(to, new NativeFile(['corrupt audio'], to) as unknown as File); t.files.delete(from)
    }
    await expect(executeJournal(t.disk, journal, null, async () => {})).rejects.toThrow('Rename could not be verified')
    expect(t.files.has(JOURNAL_PATH)).toBe(true)
  })
  it('handles a swap cycle and commits only verified playlists', async () => {
    const t = fixture(), journal = await t.make(), saved: SyncJournal[] = []
    const done = await executeJournal(t.disk, journal, null, async value => { saved.push(value) })
    expect(done.phase).toBe('complete')
    expect(saved.map(value => value.phase)).toEqual(['staging', 'finalizing', 'writing', 'complete'])
    expect(await t.files.get('01 - Same.wav')!.text()).toBe('second audio')
    expect(await t.files.get('02 - Same.wav')!.text()).toBe('first audio')
  })
  it.each(Array.from({ length: 9 }, (_, index) => index + 1).flatMap(at => [[at, false], [at, true]] as const))('recovers interruption at mutation %i (after effect: %s)', async (at, effect) => {
    const t = fixture(), journal = await t.make(); t.interrupt(at, effect)
    await expect(executeJournal(t.disk, journal, null, async () => {})).rejects.toThrow('Injected interruption')
    t.reset(); const persisted = await readJournal(t.disk)
    const done = await executeJournal(t.disk, persisted?.journal ?? journal, persisted?.bytes ?? null, async () => {})
    expect(done.phase).toBe('complete')
    expect(await t.files.get('01 - Same.wav')!.text()).toBe('second audio')
    expect(await t.files.get('02 - Same.wav')!.text()).toBe('first audio')
    expect([...t.files.keys()].filter(name => name.startsWith('.meloark-test-'))).toEqual([])
  })
  it('does not touch audio when durable cache persistence fails', async () => {
    const t = fixture()
    await expect(executeJournal(t.disk, await t.make(), null, async () => { throw new Error('Quota') })).rejects.toThrow('Quota')
    expect(t.files.has(JOURNAL_PATH)).toBe(false)
    expect(await t.files.get('01 - Same.wav')!.text()).toBe('first audio')
  })
  it('stops on a foreign occupied target without overwriting it', async () => {
    const t = fixture(), journal = await t.make(); t.interrupt(4, false)
    await expect(executeJournal(t.disk, journal, null, async () => {})).rejects.toThrow()
    t.reset(); t.files.set('02 - Same.wav', new NativeFile(['foreign content'], '02 - Same.wav') as unknown as File)
    const persisted = (await readJournal(t.disk))!
    await expect(executeJournal(t.disk, persisted.journal, persisted.bytes, async () => {})).rejects.toThrow(/cannot choose safely/)
    expect(await t.files.get('02 - Same.wav')!.text()).toBe('foreign content')
  })
  it('retains recovery after a dependent playlist changes externally', async () => {
    const t = fixture(), journal = await t.make(); t.interrupt(7, true)
    await expect(executeJournal(t.disk, journal, null, async () => {})).rejects.toThrow()
    t.reset(); t.files.set('List.m3u8', new NativeFile(['external change'], 'List.m3u8') as unknown as File)
    const persisted = (await readJournal(t.disk))!
    await expect(executeJournal(t.disk, persisted.journal, persisted.bytes, async () => {})).rejects.toThrow('Conflict')
    expect(t.files.has(JOURNAL_PATH)).toBe(true)
    expect(await t.files.get('List.m3u8')!.text()).toBe('external change')
  })
  it('rejects path traversal and unrestricted writes in a journal', async () => {
    const t = fixture(), journal = await t.make()
    expect(() => parseJournal(journalBytes({ ...journal, moves: [{ ...journal.moves[0], target: '../outside.wav' }] }))).toThrow(/Unsafe/)
    expect(() => parseJournal(journalBytes({ ...journal, patches: [{ path: 'audio.wav', before: null, after: [] }] }))).toThrow(/Unsafe/)
  })
})
