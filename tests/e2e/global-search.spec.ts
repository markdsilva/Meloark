import { trackRow } from './helpers/ui'
import { test, expect, type Page } from '@playwright/test'
import { taggedWav, wavSample } from '../fixtures/audio'

const search = (page: Page) => page.getByRole('combobox', { name: 'Search all music', exact: true })
const results = (page: Page) => page.getByRole('listbox', { name: 'Music search results', exact: true })
const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
async function load(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    ...['Café Lights', 'Evening', 'Sunrise'].map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(taggedWav(30, { title: name, artist: 'Björk', album: 'Nightfall' })) })),
    { name: 'cover.png', mimeType: 'image/png', buffer: cover },
    { name: 'Listening.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nEvening.wav\nSunrise.wav\n') },
    { name: 'Road trip.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nCafé Lights.wav\nEvening.wav\nMissing.wav\n') },
  ])
  await page.getByRole('button', { name: 'Listening.m3u8', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Listening', exact: true })).toBeVisible()
}
async function snapshot(page: Page) {
  return { heading: await page.locator('h1').textContent(), rows: await page.locator('.track-title strong').allTextContents(), selected: await page.locator('.track-row[aria-selected="true"]').count() }
}
test('top-bar search has stable geometry and rich results without filtering the active playlist', async ({ page }, info) => {
  await load(page)
  await trackRow(page, 'Evening').click({ modifiers: ['ControlOrMeta'] })
  const before = await snapshot(page), field = page.locator('.global-search-field'), box = (await field.boundingBox())!
  await search(page).fill('cafe')
  await expect(results(page).getByRole('option')).toHaveCount(1)
  await expect(results(page).getByRole('option')).toContainText('Café Lights')
  await expect(results(page).getByRole('option').locator('.artwork img')).toBeVisible()
  const after = (await field.boundingBox())!
  expect(after).toEqual(box)
  expect(await snapshot(page)).toEqual(before)
  await page.screenshot({ path: `test-results/global-search-desktop-${info.project.name}.png`, fullPage: true })
  await search(page).fill('<script>not a song</script>')
  await expect(page.locator('.global-search-empty')).toContainText('No matches')
  await expect(results(page).locator('script')).toHaveCount(0)
  await search(page).press('Escape')
  await expect(results(page)).toHaveCount(0)
})
test('a song from another library plays while the original playlist and selection stay in place', async ({ page }) => {
  await load(page)
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    { name: 'Other recording.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavSample(30)) },
    { name: 'Other mix.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nOther recording.wav\n') },
  ])
  await expect(page.getByRole('heading', { name: 'Other mix', exact: true })).toBeVisible()
  await trackRow(page, 'Other recording').click({ modifiers: ['ControlOrMeta'] })
  const before = await snapshot(page)
  await search(page).fill('Café Lights')
  await results(page).getByRole('option').click()
  await expect(page.locator('.now-playing strong')).toHaveText('Café Lights')
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect(page.locator('.now-playing')).toContainText('Search queue')
  expect(await snapshot(page)).toEqual(before)
  await search(page).fill('Sunrise')
  await expect(results(page).getByRole('option')).toContainText('Sunrise')
  await expect(page.locator('.now-playing strong')).toHaveText('Café Lights')
  await search(page).press('Escape')
  await page.getByRole('button', { name: 'Play Other recording', exact: true }).click()
  await expect(page.locator('.now-playing strong')).toHaveText('Other recording')
})
test('explores an unopened playlist inside search without creating a session or changing the current view', async ({ page }) => {
  await load(page)
  const before = await snapshot(page)
  await search(page).fill('Road trip')
  await expect(results(page).getByRole('option')).toHaveCount(1)
  await results(page).getByRole('option').click()
  await expect(page.locator('.global-search-heading')).toContainText('Road trip')
  await expect(results(page).getByRole('option')).toHaveCount(2)
  await expect(page.locator('.global-search-footer')).toContainText('1 unavailable playlist entry')
  expect(await snapshot(page)).toEqual(before)
  await page.getByRole('button', { name: 'Search all libraries', exact: true }).click()
  await expect(page.locator('.global-search-heading')).toContainText('Search your music')
  await expect(results(page).getByRole('option')).toHaveCount(3)
})
test('artist and album exploration uses real metadata and keeps song ordering untouched', async ({ page }) => {
  await load(page)
  const before = await snapshot(page)
  await search(page).fill('bjork')
  await expect(results(page).getByRole('option').filter({ hasText: /^Björk/ })).toHaveCount(1)
  await results(page).getByRole('option').filter({ hasText: /^Björk/ }).click()
  await expect(results(page).getByRole('option')).toHaveCount(3)
  await expect(page.locator('.global-search-heading')).toContainText('Artist')
  await page.getByRole('button', { name: 'Search all libraries', exact: true }).click()
  await search(page).fill('Nightfall')
  await results(page).getByRole('option').filter({ hasText: /^Nightfall/ }).click()
  await expect(page.locator('.global-search-heading')).toContainText('Album')
  await expect(results(page).getByRole('option')).toHaveCount(3)
  expect(await snapshot(page)).toEqual(before)
})
test('keyboard shortcuts, fast edits, dismissal and disconnected libraries remain usable', async ({ page }) => {
  await load(page)
  await page.keyboard.press('Control+k'); await expect(search(page)).toBeFocused()
  await search(page).fill('wrong'); await search(page).fill('Café'); await search(page).fill('Sunrise')
  await expect(results(page).getByRole('option')).toHaveCount(1)
  await expect(results(page).getByRole('option')).toContainText('Sunrise')
  await search(page).press('Enter')
  await expect(page.locator('.now-playing strong')).toHaveText('Sunrise')
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(results(page).getByRole('option')).toHaveCount(3)
  await search(page).press('ArrowDown'); await expect(search(page)).toHaveAttribute('aria-activedescendant', /option-1$/)
  await search(page).press('Tab'); await expect(results(page)).toHaveCount(0)
  await search(page).click(); await page.locator('h1').click(); await expect(results(page)).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Reconnect your music', { exact: true })).toBeVisible()
  await search(page).fill('Sunrise')
  await expect(results(page).getByRole('option')).toHaveAttribute('aria-disabled', 'true')
  await expect(results(page).getByRole('option')).toContainText('Reconnect to play')
})
test('search fits desktop, narrow layouts, mobile and reduced motion', async ({ page }, info) => {
  await load(page)
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.keyboard.press('Control+k')
    await expect(search(page)).toBeFocused()
    await search(page).fill('Café')
    await expect(results(page).getByRole('option')).toHaveCount(1)
    const panel = (await page.locator('.global-search-panel').boundingBox())!, field = (await page.locator('.global-search-field').boundingBox())!
    expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(width)
    expect(field.x).toBeGreaterThanOrEqual(0); expect(field.x + field.width).toBeLessThanOrEqual(width)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width === 320) await page.screenshot({ path: `test-results/global-search-mobile-${info.project.name}.png`, fullPage: true })
    await search(page).press('Escape'); await expect(results(page)).toHaveCount(0)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.keyboard.press('Control+k')
  await expect(page.locator('.global-search-panel')).toHaveCSS('animation-name', 'none')
  await search(page).press('Escape')
  await expect(page.getByRole('button', { name: 'Search all music', exact: true })).toBeFocused()
})
