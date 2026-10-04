import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { BitrateReader } from './bitrateReader'
import { declaredMp3Bitrate, windowBitrate } from './bitrateMath'
import { adtsFrames, aiffPcm, flacFrames, mp3Frames, muxedPackets, oggFlacFrames } from '../../tests/fixtures/encoded'
import { wavSample } from '../../tests/fixtures/audio'

const file = (bytes: Uint8Array, name: string) => new NodeFile([new Uint8Array(bytes).buffer], name) as unknown as File
beforeEach(() => vi.stubGlobal('Blob', NodeBlob))
afterEach(() => vi.unstubAllGlobals())
describe('local encoded-source bitrate', () => {
  it('apportions edge packets by their actual timing and ignores invalid or nonaudio packets', () => {
    const packets = [{ timestamp: -0.25, duration: 0.5, byteLength: 100 }, { timestamp: 0.25, duration: 0.5, byteLength: 300 }, { timestamp: 0, duration: 0, byteLength: 1000 }]
    expect(windowBitrate(packets, 0, 0.75)).toBeCloseTo(350 * 8 / 0.75)
    expect(windowBitrate(packets, 2, 3)).toBeUndefined()
  })
  it('requires an explicit Info tag for declared CBR, even when initial frames match', async () => {
    expect(await declaredMp3Bitrate(file(mp3Frames(true), 'VBR.mp3'))).toBeUndefined()
    expect(await declaredMp3Bitrate(file(mp3Frames(false, true), 'CBR.mp3'))).toBe(128000)
  })
  it.each(['mp3', 'aac', 'flac', 'mp4', 'ogg'] as const)('reads variable %s packets without any decoder', async format => {
    const bytes = format === 'mp3' ? mp3Frames(true) : format === 'aac' ? adtsFrames() : format === 'flac' ? flacFrames() : await muxedPackets(format, format === 'ogg' ? 312 : 0)
    const reader = new BitrateReader(file(bytes, `Sample.${format}`))
    try {
      const early = await reader.sample(0.1), late = await reader.sample(1.5)
      expect(early.kind).toBe('live'); expect(late.bitrate).toBeGreaterThan(early.bitrate)
      expect(early.average).toBeGreaterThan(0)
      const again = await reader.sample(0.1); expect(again.bitrate).toBeCloseTo(early.bitrate)
    } finally { reader.dispose() }
  })
  it.each(['wav', 'aiff'] as const)('calculates constant %s PCM bitrate', async format => {
    const reader = new BitrateReader(file(format === 'wav' ? wavSample() : aiffPcm(), `Sample.${format}`))
    try { expect((await reader.sample(0.5)).bitrate).toBe(128000); expect((await reader.sample(0.8)).kind).toBe('constant') } finally { reader.dispose() }
  })
  it('reports declared MP3 CBR consistently despite frame padding', async () => {
    const reader = new BitrateReader(file(mp3Frames(false, true), 'CBR.mp3'))
    try { expect((await reader.sample(0.5)).kind).toBe('constant'); expect((await reader.sample(1.5)).bitrate).toBe(128000) } finally { reader.dispose() }
  })
  it('rejects malformed data without producing a guessed bitrate', async () => {
    const reader = new BitrateReader(file(new Uint8Array([1, 2, 3]), 'Broken.flac'))
    await expect(reader.sample(0)).rejects.toThrow(); reader.dispose()
  })
  it.each([false, true])('reads Ogg FLAC frame timing, checksums, and continuation (%s)', async split => {
    const reader = new BitrateReader(file(oggFlacFrames(split), 'Lossless.ogg'))
    try {
      const early = await reader.sample(0.1), late = await reader.sample(1.3)
      expect(late.bitrate).toBeGreaterThan(early.bitrate); expect(early.average).toBeGreaterThan(0)
      expect((await reader.sample(0.1)).bitrate).toBe(early.bitrate)
    } finally { reader.dispose() }
  })
  it('bounds Ogg FLAC coverage and resumes from sparse checkpoints after backward seeking', async () => {
    const reader = new BitrateReader(file(oggFlacFrames(false, 1024), 'Long.ogg'))
    try {
      const early = await reader.sample(0.1); expect(early.average).toBeUndefined()
      const late = await reader.sample(20); expect(late.bitrate).toBeGreaterThan(early.bitrate)
      expect((await reader.sample(0.1)).bitrate).toBe(early.bitrate)
      expect((await reader.sample(12)).bitrate).toBeGreaterThan(0)
    } finally { reader.dispose() }
  })
  it('rejects corrupted and truncated Ogg FLAC without guessing', async () => {
    const bytes = oggFlacFrames(); bytes[bytes.length - 8] ^= 1
    const corrupt = new BitrateReader(file(bytes, 'Bad.ogg')), truncated = new BitrateReader(file(oggFlacFrames().slice(0, -8), 'Partial.ogg'))
    try { await expect(corrupt.sample(0.5)).rejects.toThrow(/checksum/); await expect(truncated.sample(0.5)).rejects.toThrow() }
    finally { corrupt.dispose(); truncated.dispose() }
  })
})
