import { test, expect, type Page } from '@playwright/test'
import { wavSample } from '../fixtures/audio'

async function load(page: Page) {
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    { name: 'Song.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavSample(30)) },
    { name: 'Song.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00]A softly highlighted test line\n[00:05]Another readable line\n[00:10]Привет 世界 café') },
    { name: 'A long playlist name that must stay aligned and truncate.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nSong.wav\n') },
  ])
  await expect(page.locator('.track-title strong')).toHaveText(['Song'])
  await page.evaluate(async () => {
    const path = '/src/app/store.ts', { useApp } = await import(path)
    useApp.setState({ libraries: useApp.getState().libraries.map((library: { name: string }) => ({ ...library, name: 'A long local library name that should truncate safely' })) })
  })
}

test('volume has consistent fill, endpoint and keyboard behavior', async ({ page }) => {
  await page.goto('/')
  const volume = page.getByRole('slider', { name: 'Volume', exact: true })
  await expect(volume).toHaveClass(/player-range/)
  await volume.focus(); await page.keyboard.press('Home'); await expect(volume).toHaveValue('0')
  expect(await volume.evaluate(element => element.style.getPropertyValue('--range-fill'))).toBe('0%')
  await page.keyboard.press('End'); await expect(volume).toHaveValue('1')
  expect(await volume.evaluate(element => element.style.getPropertyValue('--range-fill'))).toBe('100%')
  await page.keyboard.press('ArrowLeft'); await expect(volume).toHaveValue('0.99')
  await expect(volume).toBeFocused()
  const seek = page.getByRole('slider', { name: 'Seek', exact: true })
  await expect(seek).toBeDisabled()
  expect(await seek.evaluate(element => element.style.getPropertyValue('--range-fill'))).toBe('0%')
})

test('progress follows native keyboard seeking and shares the volume treatment', async ({ page }, info) => {
  test.skip(info.project.name === 'webkit' && process.platform === 'win32', 'Windows WebKit has no native audio decoder.')
  await load(page)
  await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
  const footer = page.getByRole('contentinfo')
  await expect(footer.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await footer.getByRole('button', { name: 'Pause', exact: true }).click()
  const seek = footer.getByRole('slider', { name: 'Seek', exact: true })
  await expect(seek).toHaveClass(/player-range/)
  await seek.focus(); await page.keyboard.press('Home'); await expect(seek).toHaveValue('0')
  await page.keyboard.press('ArrowRight'); await expect(seek).toHaveValue('0.1')
  await seek.fill('15'); await expect(seek).toHaveValue('15')
  expect(await seek.evaluate(element => element.style.getPropertyValue('--range-fill'))).toBe('50%')
  await seek.evaluate(element => element.addEventListener('input', () => element.dataset.endpoint = (element as HTMLInputElement).value, { once: true, capture: true }))
  // Firefox may emit ended at the exact endpoint even while paused. The queue
  // is allowed to finish; the range must still send the full-duration seek.
  await page.keyboard.press('End'); await expect(seek).toHaveAttribute('data-endpoint', '30')
})

test('sidebar geometry, restrained lyrics and responsive targets remain accessible', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await load(page)
  await page.evaluate(async () => {
    const appPath = '/src/app/store.ts', playerPath = '/src/playback/player.ts'
    const { useApp, sources } = await import(appPath), { player, usePlayer } = await import(playerPath)
    const library = useApp.getState().libraries[0], track = Object.values(library.tracks)[0] as { id: string }
    const context = { kind: 'library', libraryId: library.id }
    player.configure(context, [{ id: track.id, trackId: track.id }], library.tracks, sources.get(library.id))
    player.queue.start(track.id)
    usePlayer.setState({ track, current: track.id, context, duration: 30, position: 0, playing: false })
  })
  const sidebar = page.getByRole('complementary', { name: 'Library navigation' })
  for (const row of await sidebar.locator('.nav-item').all()) {
    const metrics = await row.evaluate(element => { const css = getComputedStyle(element), svg = element.querySelector('svg')!; return { height: element.getBoundingClientRect().height, padding: css.paddingLeft, gap: css.gap, icon: svg.getBoundingClientRect().width, stroke: getComputedStyle(svg).strokeWidth } })
    expect(metrics.height).toBe(42); expect(metrics.padding).toBe('12px'); expect(metrics.gap).toBe('12px'); expect(metrics.icon).toBe(18); expect(metrics.stroke).toBe('1.75px')
  }
  for (const name of await sidebar.locator('.library-name').all()) {
    expect(await name.evaluate(element => ({ truncated: element.scrollWidth > element.clientWidth, overflow: getComputedStyle(element).textOverflow }))).toEqual({ truncated: true, overflow: 'ellipsis' })
  }
  const libraryRow = sidebar.locator('.library-nav')
  const close = libraryRow.locator('.forget'), more = libraryRow.locator('.row-more')
  const a = (await close.boundingBox())!, b = (await more.boundingBox())!
  expect(a.width).toBe(24); expect(a.height).toBe(24); expect(b.width).toBe(24); expect(b.y).toBe(a.y)
  await close.hover(); await expect(close).toHaveCSS('background-color', 'rgb(28, 28, 28)'); await expect(close).toHaveCSS('color', 'rgb(243, 240, 234)')
  await more.hover(); await expect(more).toHaveCSS('background-color', 'rgb(28, 28, 28)'); await expect(more).toHaveCSS('color', 'rgb(243, 240, 234)')
  const toggle = page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true })
  const toggleBox = (await toggle.boundingBox())!
  expect(1440 - toggleBox.x - toggleBox.width).toBe(36)
  await toggle.click(); await toggle.hover()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.focus(); await page.keyboard.press('Tab')
  const panel = page.locator('#lyrics-panel')
  await expect(panel.locator('.lyric-line.current')).toHaveText('A softly highlighted test line')
  await panel.getByRole('button', { name: 'Lyrics options', exact: true }).hover()
  const style = await panel.locator('.lyric-line.current').evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor, shadow: getComputedStyle(element).boxShadow, edge: getComputedStyle(element, '::before').opacity }))
  expect(style.background).toBe('rgba(0, 0, 0, 0)'); expect(style.shadow).toBe('none'); expect(style.edge).toBe('1')
  expect(style.color).not.toBe(await panel.locator('.lyric-line').nth(1).evaluate(element => getComputedStyle(element).color))
  await page.screenshot({ path: `test-results/polish-desktop-${info.project.name}.png`, fullPage: true })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const [width, height] of [[320, 700], [390, 844], [768, 844], [1024, 768], [1440, 900], [720, 450]]) {
    await page.setViewportSize({ width, height }); await expect(panel).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(panel.locator('.lyric-line.current')).toBeVisible()
    if (width === 390) await page.screenshot({ path: `test-results/polish-mobile-${info.project.name}.png` })
  }
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect(page.locator('.app')).toHaveClass(/collapsed/)
  await page.getByRole('button', { name: 'Libraries and playlists', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Libraries and playlists', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(toggle).toBeVisible(); expect((await toggle.boundingBox())!.width).toBe(44)
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click()
  for (const button of await page.getByRole('dialog', { name: 'Navigation', exact: true }).locator('.forget, .row-more').all()) expect((await button.boundingBox())!.width).toBe(44)
})

test('local Inter loads without external requests and fallback preserves layout', async ({ page }) => {
  const external: string[] = []
  page.on('request', request => { if (request.url().startsWith('https://')) external.push(request.url()) })
  await load(page)
  expect(await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(font => font.family === 'Inter' && font.status === 'loaded') })).toBe(true)
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/^Inter,/)
  expect(external).toEqual([])
  await page.route('**/fonts/InterVariable.woff2', route => route.abort())
  await load(page)
  await expect(page.getByRole('heading', { name: 'A long playlist name that must stay aligned and truncate', exact: true })).toBeVisible()
  expect(await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].every(font => font.family !== 'Inter' || font.status !== 'loaded') })).toBe(true)
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  expect(external).toEqual([])
})

test('site metadata references valid local favicon and app-icon assets', async ({ page, request }) => {
  await page.goto('/')
  const icon = page.locator('link[rel="icon"][type="image/svg+xml"]')
  const svg = await request.get((await icon.getAttribute('href'))!)
  expect(svg.ok()).toBe(true); expect(await svg.text()).toContain('viewBox="0 0 64 64"')
  const ico = await request.get((await page.locator('link[rel="icon"][sizes="16x16 32x32 48x48"]').getAttribute('href'))!)
  expect(ico.ok()).toBe(true)
  const bytes = await ico.body()
  expect(bytes.readUInt16LE(2)).toBe(1); expect(bytes.readUInt16LE(4)).toBe(3)
  expect([0, 1, 2].map(index => bytes[6 + index * 16])).toEqual([16, 32, 48])
  const manifest = await request.get((await page.locator('link[rel="manifest"]').getAttribute('href'))!)
  expect(manifest.ok()).toBe(true)
  const data = await manifest.json()
  expect(data.display).toBe('browser'); expect(data.theme_color).toBe('#151515')
  for (const entry of data.icons) {
    const image = await request.get(new URL(entry.src, manifest.url()).href)
    expect(image.ok()).toBe(true)
    const png = await image.body(), size = Number(entry.sizes.split('x')[0])
    expect(png.subarray(1, 4).toString()).toBe('PNG'); expect(png.readUInt32BE(16)).toBe(size); expect(png.readUInt32BE(20)).toBe(size)
  }
  const apple = await request.get((await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'))!)
  expect(apple.ok()).toBe(true); expect((await apple.body()).readUInt32BE(16)).toBe(180)
  const font = await request.get((await page.locator('link[rel="preload"][as="font"]').getAttribute('href'))!)
  expect(font.ok()).toBe(true); expect((await font.body()).subarray(0, 4).toString()).toBe('wOF2')
})
