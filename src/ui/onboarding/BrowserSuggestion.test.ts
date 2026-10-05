import { describe, expect, it } from 'vitest'
import { isChromiumBrowser } from './BrowserSuggestion'

describe('optional browser recommendation', () => {
  it('recognizes Chromium brands without using browser identity for features', () => {
    expect(isChromiumBrowser({ userAgent: '', userAgentData: { brands: [{ brand: 'Not A Brand' }, { brand: 'Chromium' }] } })).toBe(true)
    expect(isChromiumBrowser({ userAgent: 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36' })).toBe(true)
    expect(isChromiumBrowser({ userAgent: 'Mozilla/5.0 Chrome/130.0.0.0 Edg/130.0.0.0' })).toBe(true)
    expect(isChromiumBrowser({ userAgent: 'Mozilla/5.0 Firefox/130.0' })).toBe(false)
    expect(isChromiumBrowser({ userAgent: 'Mozilla/5.0 Version/18.0 Safari/605.1.15' })).toBe(false)
  })
  it('does not promise Chromium filesystem support for iOS browser names', () => {
    expect(isChromiumBrowser({ userAgent: 'Mozilla/5.0 (iPhone) CriOS/130.0.0.0 Mobile Safari/604.1' })).toBe(false)
    expect(isChromiumBrowser({ userAgent: 'Mozilla/5.0 (iPad) EdgiOS/130.0.0.0 Mobile Safari/604.1' })).toBe(false)
  })
})
