import { test, expect, type Page } from '@playwright/test'
import { wavSample } from '../fixtures/audio'

async function load(page: Page) {
  await page.goto('/')
  const covers = await page.evaluate(() => ['#c62c47', '#224bd1'].map(color => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
    const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 64, 64)
    return canvas.toDataURL('image/png').split(',')[1]
  }))
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    ...['Red', 'Blue', 'Missing', 'Invalid'].map(name => ({ name: `${name}/${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(wavSample(30)) })),
    { name: 'Red/cover.png', mimeType: 'image/png', buffer: Buffer.from(covers[0], 'base64') },
    { name: 'Blue/cover.png', mimeType: 'image/png', buffer: Buffer.from(covers[1], 'base64') },
    { name: 'Invalid/cover.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
    { name: 'Red/Red.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00]Warm words in amber\n[00:05]A second line\n[00:10]Keep following the music') },
    { name: 'Blue/Blue.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00]Cool tones, warm words\n[00:05]A quiet change of color') },
  ])
  await expect(page.locator('.track-title strong')).toHaveText(['Blue', 'Invalid', 'Missing', 'Red'])
  await expect(page.locator('.track-row').filter({ has: page.getByRole('button', { name: 'Play Blue', exact: true }) }).locator('.artwork img')).toBeAttached()
}
const stage = (page: Page) => page.locator('.ambient-workspace .ambient-arriving')
async function primary(page: Page) { return stage(page).evaluate(element => element.style.getPropertyValue('--ambient-primary').match(/[\d.]+/g)!.map(Number)) }
async function settle(page: Page) { await expect(stage(page)).toHaveCSS('opacity', '1') }

test('artwork colors fade across the workspace and lyrics while playback and search stay independent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await load(page)
  const sidebar = page.locator('.sidebar-shell'), before = await sidebar.evaluate(element => getComputedStyle(element).backgroundColor)
  const toggle = page.getByRole('button', { name: 'Artwork backgrounds', exact: true })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Play Red', exact: true }).click()
  await expect.poll(async () => { const color = await primary(page); return color[0] > color[2] * 2 }).toBe(true)
  await settle(page)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true }).click()
  const palette = await primary(page), layer = await stage(page).elementHandle()
  await page.getByRole('contentinfo').getByRole('slider', { name: 'Seek', exact: true }).fill('8')
  expect(await primary(page)).toEqual(palette)
  expect(await layer!.evaluate(element => element.isConnected)).toBe(true)
  expect(await sidebar.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(before)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true }).click()
  await expect(page.locator('.lyric-line.current')).toHaveText('A second line')
  await expect(page.locator('.lyric-line.current')).toHaveCSS('color', 'rgb(227, 175, 108)')
  expect(await page.locator('.lyric-line.current').evaluate(element => getComputedStyle(element, '::before').content)).toBe('none')
  await expect(page.locator('.lyrics-scroll')).toHaveCSS('scrollbar-width', 'none')
  await page.screenshot({ path: 'test-results/ambient-red-desktop.png' })
  // Lyrics narrow the main area enough to use the compact search overlay.
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search all music', exact: true }).fill('Blue')
  await expect(page.getByRole('option').filter({ hasText: 'Blue' }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Lyrics', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play Blue', exact: true }).click()
  await expect.poll(async () => { const color = await primary(page); return color[2] > color[0] * 2 }).toBe(true)
  // A slow fade is running, rather than an abrupt color swap.
  expect(Number(await stage(page).evaluate(element => getComputedStyle(element).opacity))).toBeLessThan(1)
  await settle(page)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('contentinfo').getByRole('slider', { name: 'Seek', exact: true }).fill('0')
  await expect(page.locator('.lyric-line.current')).toContainText('Cool tones, warm words')
  await page.screenshot({ path: 'test-results/ambient-blue-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  const drawer = page.getByRole('dialog', { name: 'Lyrics', exact: true })
  await expect(drawer).toBeVisible()
  // A late-mounted surface must already show the settled palette, not replay
  // the workspace's previous amber-to-blue transition.
  expect(await drawer.locator('.ambient-arriving').evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Play Red', exact: true }).click()
  await page.getByRole('button', { name: 'Play Blue', exact: true }).click()
  await page.getByRole('button', { name: 'Play Missing', exact: true }).click()
  await expect.poll(() => primary(page)).toEqual([43, 33, 22])
  await settle(page)
  await expect(page.locator('.ambient-workspace .ambient-layer')).toHaveCount(2)
  await page.getByRole('button', { name: 'Play Invalid', exact: true }).click()
  await expect.poll(() => primary(page)).toEqual([43, 33, 22])
  await page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true }).click()
})

test('the ambient toggle persists and reduced motion, mobile lyrics and menus remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await load(page)
  await page.getByRole('button', { name: 'Play Blue', exact: true }).click()
  await expect.poll(async () => { const color = await primary(page); return color[2] > color[0] * 2 }).toBe(true)
  await expect(stage(page)).toHaveCSS('animation-name', 'none')
  const toggle = page.getByRole('button', { name: 'Artwork backgrounds', exact: true })
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => primary(page)).toEqual([43, 33, 22])
  await page.reload(); await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await load(page)
  await page.getByRole('button', { name: 'Play Red', exact: true }).click()
  await expect.poll(() => primary(page)).toEqual([43, 33, 22])
  await toggle.click(); await expect.poll(async () => { const color = await primary(page); return color[0] > color[2] * 2 }).toBe(true)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Lyrics', exact: true })
  await expect(dialog).toBeVisible()
  expect(await dialog.locator('.ambient-arriving').evaluate(element => element.style.getPropertyValue('--ambient-primary'))).toBe(await stage(page).evaluate(element => element.style.getPropertyValue('--ambient-primary')))
  await dialog.getByRole('button', { name: 'Lyrics options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Import LRC', exact: true }).press('Escape')
  await expect(dialog.getByRole('button', { name: 'Lyrics options', exact: true })).toBeFocused()
  await page.screenshot({ path: 'test-results/ambient-mobile.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('contentinfo').getByRole('button', { name: 'Expand player', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Now playing', exact: true }).getByRole('slider', { name: 'Seek', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  for (const [width, height] of [[320, 700], [720, 450], [1024, 768]]) {
    await page.setViewportSize({ width, height })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
})
