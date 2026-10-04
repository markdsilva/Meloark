import { expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { newId } from './models'
it('keeps portable identity available without secure-context randomUUID', () => {
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
  const ids = new Set(Array.from({ length: 100 }, newId))
  expect(ids.size).toBe(100)
  expect([...ids].every(id => /^[a-f0-9]{32}$/.test(id))).toBe(true)
  vi.unstubAllGlobals()
})
