import { test, expect, type Page } from '@playwright/test'
import { wavSample } from '../fixtures/audio'

async function load(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    { name: 'Song.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavSample(8)) },
    { name: 'Listening.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nSong.wav\n') },
  ])
  await expect(page.getByRole('heading', { name: 'Listening', exact: true })).toBeVisible()
}
const width = (page: Page) => page.locator('.sidebar-shell').evaluate(element => Math.round(element.getBoundingClientRect().width))
async function startDrag(page: Page) {
  const handle = page.getByRole('separator', { name: 'Resize sidebar' })
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 180)
  await page.mouse.down()
  return { x: box.x + box.width / 2, width: await width(page) }
}
async function dragTo(page: Page, next: number) {
  const start = await startDrag(page)
  await page.mouse.move(start.x + next - start.width, 250)
}

test('sidebar resize follows the pointer, clamps and persists independently of collapse', async ({ page }) => {
  await load(page)
  await expect.poll(() => width(page)).toBe(240)
  await dragTo(page, 322)
  await expect.poll(() => width(page)).toBe(322)
  await expect(page.locator('.app')).toHaveClass(/sidebar-resizing/)
  await expect(page.locator('.app')).toHaveCSS('transition-duration', '0s')
  // Leave the handle while captured; a release must still commit the width.
  await page.mouse.move(1100, 300); await page.mouse.up()
  await expect.poll(() => width(page)).toBe(360)
  await expect(page.locator('.app')).not.toHaveClass(/sidebar-resizing/)
  expect(await page.evaluate(() => localStorage.getItem('meloark-sidebar-width'))).toBe('360')
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect.poll(() => width(page)).toBe(64)
  await expect(page.getByRole('separator', { name: 'Resize sidebar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'All tracks', exact: true })).toHaveCount(1)
  await page.reload(); await expect.poll(() => width(page)).toBe(64)
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  await expect.poll(() => width(page)).toBe(360)
  await startDrag(page); await page.mouse.move(0, 250); await page.mouse.up()
  await expect.poll(() => width(page)).toBe(220)
  await expect(page.locator('.track-title strong')).toHaveText(['Song'])
})

test('keyboard resizing, cancel, lost capture and reset keep the last committed preference', async ({ page }) => {
  await load(page)
  const handle = page.getByRole('separator', { name: 'Resize sidebar' })
  await handle.focus(); await page.keyboard.press('ArrowRight')
  await expect(handle).toHaveAttribute('aria-valuenow', '248')
  await page.keyboard.press('Shift+ArrowRight'); await expect.poll(() => width(page)).toBe(272)
  await dragTo(page, 354); await expect.poll(() => width(page)).toBe(354)
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect.poll(() => width(page)).toBe(272)
  expect(await page.evaluate(() => localStorage.getItem('meloark-sidebar-width'))).toBe('272')
  await startDrag(page); await page.mouse.move(320, 250)
  await handle.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up(); await expect.poll(() => width(page)).toBe(272)
  await startDrag(page); await page.mouse.move(320, 250)
  await handle.dispatchEvent('lostpointercapture'); await page.mouse.up()
  await expect.poll(() => width(page)).toBe(272)
  await handle.focus(); await page.keyboard.press('Home'); await expect(handle).toHaveAttribute('aria-valuenow', '220')
  await page.keyboard.press('End'); await expect(handle).toHaveAttribute('aria-valuenow', '360')
  await expect.poll(() => width(page)).toBe(360)
  await handle.dblclick(); await expect.poll(() => width(page)).toBe(240)
  await page.reload(); await expect.poll(() => width(page)).toBe(240)
})

test('resizing stays within narrow desktop layouts and mobile navigation remains a drawer', async ({ page }) => {
  await load(page)
  const handle = page.getByRole('separator', { name: 'Resize sidebar' })
  await handle.focus(); await page.keyboard.press('End')
  await page.setViewportSize({ width: 768, height: 844 })
  await expect(handle).toHaveAttribute('aria-valuemax', '288')
  await expect(handle).toHaveAttribute('aria-valuenow', '288')
  await expect.poll(() => width(page)).toBe(288)
  expect(await page.evaluate(() => localStorage.getItem('meloark-sidebar-width'))).toBe('360')
  await page.setViewportSize({ width: 1440, height: 900 }); await expect.poll(() => width(page)).toBe(360)
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click()
  await expect(page.locator('#lyrics-panel')).toBeVisible()
  await dragTo(page, 279); await page.mouse.up()
  await expect.poll(() => width(page)).toBe(279)
  await expect(page.locator('#lyrics-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click()
  await startDrag(page); await page.mouse.move(320, 250)
  await page.setViewportSize({ width: 390, height: 844 }); await page.mouse.up()
  await expect(page.getByRole('separator')).toHaveCount(0)
  await expect(page.locator('.app')).not.toHaveClass(/sidebar-resizing/)
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  for (const viewport of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width: viewport, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport)
  }
  await expect.poll(() => width(page)).toBe(279)
})

test('collapse crossfades stable content, tolerates rapid toggles and respects reduced motion', async ({ page }) => {
  await load(page)
  const measurements = await page.evaluate(async () => {
    const app = document.querySelector('.app')!, shell = document.querySelector('.sidebar-shell')!, content = document.querySelector('.sidebar-expanded')!
    const toggle = document.querySelector<HTMLButtonElement>('.navigation-toggle')!
    const frames: { width: number; content: number }[] = []
    const began = performance.now()
    toggle.click()
    let expanded = false, collapsed = false
    while (performance.now() - began < 650) {
      await new Promise(requestAnimationFrame)
      const elapsed = performance.now() - began
      if (elapsed > 70 && !expanded) { toggle.click(); expanded = true }
      if (elapsed > 160 && !collapsed) { toggle.click(); collapsed = true }
      frames.push({ width: shell.getBoundingClientRect().width, content: content.getBoundingClientRect().width })
    }
    return { frames, collapsed: app.classList.contains('collapsed') }
  })
  expect(measurements.collapsed).toBe(true)
  expect(measurements.frames.some(frame => frame.width > 64 && frame.width < 239)).toBe(true)
  expect(measurements.frames.every(frame => frame.content === 240 && frame.width >= 63.5 && frame.width <= 240.5)).toBe(true)
  await expect.poll(() => width(page)).toBe(64)
  await page.getByRole('button', { name: 'Libraries and playlists', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Libraries and playlists', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  await expect(page.locator('.app')).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('.sidebar-expanded')).toHaveCSS('transition-duration', '0s')
  await expect.poll(() => width(page)).toBe(240)
})

test('source badge and button feedback preserve focus and active states', async ({ page }, info) => {
  await load(page)
  const source = page.getByRole('link', { name: 'Open source (opens in a new tab)' })
  await expect(source).toHaveAttribute('href', 'https://github.com/markdsilva/Meloark')
  await expect(page.getByText('Music stays local', { exact: true })).toBeVisible()
  const shuffle = page.getByRole('button', { name: 'Shuffle', exact: true })
  await shuffle.hover(); await page.mouse.down()
  await expect(shuffle).toHaveCSS('scale', '0.94')
  await page.mouse.up(); await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  await expect(shuffle).toHaveCSS('scale', 'none')
  await shuffle.focus(); await page.keyboard.press('Space'); await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
  await expect(shuffle).toBeFocused()
  await page.screenshot({ path: `test-results/sidebar-motion-desktop-${info.project.name}.png`, fullPage: true })
  await page.emulateMedia({ reducedMotion: 'reduce' }); await shuffle.hover(); await page.mouse.down()
  await expect(shuffle).toHaveCSS('scale', '1'); await page.mouse.up()
})


test('compact rail remains scrollable and keyboard reachable in short desktop windows', async ({ page }, info) => {
  await load(page)
  await page.setViewportSize({ width: 1024, height: 450 })
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect.poll(() => width(page)).toBe(64)
  const rail = page.locator('.sidebar-rail')
  expect(await rail.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  const help = rail.getByRole('button', { name: 'Browser capabilities', exact: true })
  await help.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Your browser, your library', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: `test-results/sidebar-motion-collapsed-${info.project.name}.png`, fullPage: true })
})
