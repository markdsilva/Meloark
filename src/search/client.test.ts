import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchClient } from './client'
import type { SearchReply, SearchRequest } from './types'
import type { Library } from '../app/store'

class TestWorker {
  static latest: TestWorker
  messages: SearchRequest[] = []
  onmessage?: (event: MessageEvent<SearchReply>) => void
  onerror?: () => void
  terminate = vi.fn()
  constructor() { TestWorker.latest = this }
  postMessage(message: SearchRequest) { this.messages.push(message) }
  reply(id: number) { this.onmessage?.(new MessageEvent<SearchReply>('message', { data: { type: 'results', id, results: { items: [], total: 0 } } })) }
}
const fixture = (): Library => ({ id: 'a', name: 'Music', kind: 'portable', connected: true, scanning: false, generation: 0,
  tracks: { song: { id: 'song', filename: 'Song.wav', path: 'Song.wav', size: 500_000, lastModified: 0, index: null, support: 'likely', metadataStatus: 'ready', metadata: { title: 'Song', artist: 'Artist', album: 'Album', artwork: new Blob(['picture']) } } }, playlists: ['Mix.m3u8'], files: [], sessions: {} })
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('Worker', TestWorker) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('search worker bridge', () => {
  it('sends metadata without audio or artwork, reuses unchanged snapshots, and correlates replies', async () => {
    const client = new SearchClient(), library = fixture(), first = client.search([library], 'song')
    await vi.waitFor(() => expect(TestWorker.latest.messages.some(message => message.type === 'query')).toBe(true))
    const snapshot = TestWorker.latest.messages.find(message => message.type === 'upsert')!
    expect(JSON.stringify(snapshot)).not.toContain('artwork')
    expect(snapshot).toMatchObject({ type: 'upsert', library: { tracks: [{ id: 'song', title: 'Song', artist: 'Artist' }] } })
    const query = TestWorker.latest.messages.find(message => message.type === 'query')!
    if (query.type !== 'query') throw new Error('Query not sent')
    TestWorker.latest.reply(query.id); await expect(first).resolves.toEqual({ items: [], total: 0 })
    const second = client.search([library], 'artist')
    await vi.waitFor(() => expect(TestWorker.latest.messages.filter(message => message.type === 'query')).toHaveLength(2))
    expect(TestWorker.latest.messages.filter(message => message.type === 'upsert')).toHaveLength(1)
    const next = TestWorker.latest.messages.at(-1)!
    if (next.type !== 'query') throw new Error('Query not sent')
    TestWorker.latest.reply(next.id); await second; client.dispose()
    expect(TestWorker.latest.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects a failed worker, a timed-out reply and disposal rather than hanging the interface', async () => {
    const client = new SearchClient(), first = client.search([fixture()], 'song')
    const failure = expect(first).rejects.toThrow('could not start')
    await vi.waitFor(() => expect(TestWorker.latest.messages.at(-1)?.type).toBe('query'))
    TestWorker.latest.onerror?.(); await failure
    await expect(client.search([], '')).rejects.toThrow('could not start'); client.dispose()
    const timeoutClient = new SearchClient(), timeout = timeoutClient.search([], 'song'), timeoutCheck = expect(timeout).rejects.toThrow('too long')
    await vi.waitFor(() => expect(TestWorker.latest.messages.at(-1)?.type).toBe('query'))
    await vi.advanceTimersByTimeAsync(15_000); await timeoutCheck; timeoutClient.dispose()
    const closing = new SearchClient(), pending = closing.search([], 'song'), closeCheck = expect(pending).rejects.toThrow('closed')
    await vi.waitFor(() => expect(TestWorker.latest.messages.at(-1)?.type).toBe('query'))
    closing.dispose(); await closeCheck
    expect(vi.getTimerCount()).toBe(0)
  })
  it('routes read-only playlist inspection and surfaces parsing errors without breaking later search', async () => {
    const client = new SearchClient(), bytes = new TextEncoder().encode('#EXTM3U\nSong.wav\n')
    const pending = client.preview(bytes, 'Mix.m3u8', [['Song.wav', 'song']])
    const message = TestWorker.latest.messages.at(-1)!
    expect(message).toMatchObject({ type: 'preview', path: 'Mix.m3u8', tracks: [['Song.wav', 'song']] })
    if (message.type !== 'preview') throw new Error('Preview not sent')
    TestWorker.latest.onmessage?.(new MessageEvent<SearchReply>('message', { data: { type: 'preview', id: message.id, preview: { trackIds: ['song'], missing: 0 } } }))
    await expect(pending).resolves.toEqual({ trackIds: ['song'], missing: 0 })
    const invalid = client.preview(new Uint8Array(), 'Mix.m3u8', []), check = expect(invalid).rejects.toThrow('Invalid playlist')
    const second = TestWorker.latest.messages.at(-1)!
    if (second.type !== 'preview') throw new Error('Preview not sent')
    TestWorker.latest.onmessage?.(new MessageEvent<SearchReply>('message', { data: { type: 'error', id: second.id, error: 'Invalid playlist' } }))
    await check
    const search = client.search([], '')
    await vi.waitFor(() => expect(TestWorker.latest.messages.at(-1)?.type).toBe('query'))
    const query = TestWorker.latest.messages.at(-1)!
    if (query.type !== 'query') throw new Error('Query not sent')
    TestWorker.latest.reply(query.id); await search; client.dispose()
  })
})
