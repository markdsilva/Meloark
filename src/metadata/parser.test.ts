import { describe, it, expect } from 'vitest'
import { File as NodeFile } from 'node:buffer'
import { readMetadata } from './parser'
import { wavSample } from '../../tests/fixtures/audio'
describe('metadata parsing', () => {
  it('reads native WAV duration without needing tags or artwork', async () => {
    const file = new NodeFile([new Uint8Array(wavSample()).buffer], 'Sample.wav', { type: 'audio/wav' }) as unknown as File
    const result = await readMetadata(file, 'Sample', false)
    expect(result.title).toBe('Sample')
    expect(result.duration).toBe(1)
    expect(result.codec).toContain('PCM')
    expect(result.artwork).toBeUndefined()
  })
  it('returns filename fallbacks for malformed metadata', async () => {
    const file = new NodeFile(['invalid'], 'bad.mp3', { type: 'audio/mpeg' }) as unknown as File
    const result = await readMetadata(file, 'Filename fallback', true)
    expect(result.title).toBe('Filename fallback')
    expect(result.error).toBeTruthy()
  })
})
