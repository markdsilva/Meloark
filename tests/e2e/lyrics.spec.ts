import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { wavSample } from '../fixtures/audio'

// Generated tones and original test text keep CI independent of music and lyrics services.
const lrc = '[ar:Fixture Artist]\n' + Array.from({ length: 24 }, (_, index) => `[00:${String(index).padStart(2, '0')}.00]A test lyric, line ${index}`).join('\n')
function taggedWav() {
  const audio = Buffer.from(wavSample(30)), chunks: Buffer[] = []
  for (const [id, text] of [['INAM', 'Song'], ['IART', 'Fixture Artist'], ['IPRD', 'Fixture Album']]) {
    const value = Buffer.from(text + '\0'), header = Buffer.alloc(8)
    header.write(id); header.writeUInt32LE(value.length, 4)
    chunks.push(header, value, ...(value.length % 2 ? [Buffer.alloc(1)] : []))
  }
  const info = Buffer.concat([Buffer.from('INFO'), ...chunks]), header = Buffer.alloc(8)
  header.write('LIST'); header.writeUInt32LE(info.length, 4)
  const bytes = Buffer.concat([audio, header, info]); bytes.writeUInt32LE(bytes.length - 8, 4)
  return bytes
}
async function load(page: Page, sidecar = true) {
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    { name: 'Song.wav', mimeType: 'audio/wav', buffer: taggedWav() },
    { name: 'Other.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavSample(30)) },
    ...(sidecar ? [{ name: 'Song.lrc', mimeType: 'text/plain', buffer: Buffer.from(lrc) }] : []),
  ])
  await expect(page.locator('.track-title strong')).toHaveText(['Other', 'Song'])
  await expect(page.locator('.track-row').filter({ has: page.getByRole('button', { name: 'Play Song', exact: true }) })).toContainText('Fixture Artist')
}
async function presentPausedTrack(page: Page) {
    // Presentation/recovery fixture; native seeking is tested separately.
    await page.evaluate(async () => {
      const app = '/src/app/store.ts', player = '/src/playback/player.ts'
      const { useApp, sources } = await import(app), { usePlayer, player: controller } = await import(player)
      const library = useApp.getState().libraries[0], track = Object.values(library.tracks).find((track: unknown) => (track as { path: string }).path === 'Song.wav')
      const id = (track as { id: string }).id, context = { kind: 'library', libraryId: library.id }
      controller.configure(context, [{ id, trackId: id }], library.tracks, sources.get(library.id))
      controller.queue.start(id)
      usePlayer.setState({ current: id, track, context, playing: false, duration: 30 })
    })
}
async function start(page: Page, info: TestInfo) {
  if (info.project.name === 'webkit' && process.platform === 'win32') await presentPausedTrack(page)
  else await page.getByRole('button', { name: 'Play Song', exact: true }).click()
}
function panel(page: Page) { return page.locator('#lyrics-panel') }
async function openOptions(page: Page) { await panel(page).getByRole('button', { name: 'Lyrics options', exact: true }).click() }

test('local synchronized lyrics follow native seeking, allow manual reading, and export timing corrections', async ({ page }, info) => {
  test.skip(info.project.name === 'webkit' && process.platform === 'win32', 'Native seeking requires an audio decoder.')
  await page.setViewportSize({ width: 1440, height: 900 })
  const external: string[] = []
  page.on('request', request => { if (request.url().startsWith('https://')) external.push(request.url()) })
  await load(page); await start(page, info)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true }).click()
  await expect(panel(page).locator('.lyric-line')).toHaveCount(24)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true }).click()
  await panel(page).getByRole('button', { name: 'Seek to 0:06: A test lyric, line 6', exact: true }).click()
  await expect(panel(page).locator('.lyric-line.current')).toHaveText('A test lyric, line 6')
  await expect(page.getByRole('contentinfo').getByRole('slider', { name: 'Seek', exact: true })).toHaveValue('6')
  await panel(page).getByRole('region', { name: 'Synchronized lyrics' }).hover(); await page.mouse.wheel(0, 300)
  await expect(panel(page).getByRole('button', { name: 'Follow lyrics', exact: true })).toBeVisible()
  await panel(page).getByRole('button', { name: 'Follow lyrics', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: 'Follow lyrics', exact: true })).toHaveCount(0)
  await openOptions(page); await page.getByRole('menuitem', { name: 'Adjust timing', exact: true }).click()
  await panel(page).getByRole('button', { name: 'Show lyrics 100 milliseconds later', exact: true }).click()
  await expect(panel(page).locator('.lyrics-timing')).toContainText('+0.1s')
  const downloading = page.waitForEvent('download'); await panel(page).getByRole('button', { name: 'Download LRC', exact: true }).click()
  const download = await downloading, stream = await download.createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  expect(Buffer.concat(chunks).toString()).toContain('[offset:-100]')
  expect(download.suggestedFilename()).toBe('Song.lrc')
  await expect(panel(page).getByRole('status')).toContainText('Download requested')
  expect(external).toEqual([])
  await page.screenshot({ path: `test-results/lyrics-desktop-${info.project.name}.png` })
  await page.getByRole('button', { name: 'Close lyrics', exact: true }).click()
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true })).toBeFocused()
  await expect(page.getByRole('contentinfo').getByRole('slider', { name: 'Seek', exact: true })).toHaveValue('6')
})

test('online lookup is opt-in, uses verified tags, caches results, and allows a reviewed alternative', async ({ page }, info) => {
  const requests: URL[] = []
  const response = { id: 1, trackName: 'Song', artistName: 'Fixture Artist', albumName: 'Fixture Album', duration: 30, instrumental: false, syncedLyrics: '[00:00]Online test line\n[00:05]Another test line', plainLyrics: 'Online test line\nAnother test line' }
  await page.route('https://lrclib.net/api/**', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Lrclib-Client', 'access-control-allow-methods': 'GET,OPTIONS' }
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
    const url = new URL(route.request().url()); requests.push(url)
    await route.fulfill({ json: url.pathname.endsWith('/search') ? [{ ...response, id: 2, syncedLyrics: '[00:00]Selected version' }] : response, headers })
  })
  await load(page, false); await start(page, info)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: 'Allow online lyrics', exact: true })).toBeVisible()
  expect(requests).toEqual([])
  await panel(page).getByRole('button', { name: 'Allow online lyrics', exact: true }).click()
  await expect(panel(page).locator('.lyric-line')).toHaveCount(2)
  expect(requests).toHaveLength(1)
  expect(requests[0].searchParams.get('artist_name')).toBe('Fixture Artist')
  expect(requests[0].searchParams.get('duration')).toBe('30')
  await page.keyboard.press('Escape')
  await page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true }).click()
  await expect(panel(page).locator('.lyric-line')).toHaveCount(2); expect(requests).toHaveLength(1)
  await openOptions(page); await page.getByRole('menuitem', { name: 'Find another version', exact: true }).click()
  await page.getByRole('button', { name: 'Search lyrics', exact: true }).click()
  await page.getByRole('button', { name: /Song Fixture Artist.*Synced/ }).click()
  await expect(panel(page).locator('.lyric-line')).toHaveText(['Selected version'])
  await page.waitForTimeout(400); await page.reload()
  await expect(page.locator('.track-title strong')).toHaveText(['Other', 'Song'])
  await presentPausedTrack(page)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true }).click()
  await expect(panel(page).locator('.lyric-line')).toHaveText(['Selected version'])
  expect(requests).toHaveLength(2)
})

test('lyrics fit narrow, landscape and zoom-equivalent layouts and retain keyboard access', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 844 })
  await load(page); await start(page, info)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true }).click()
  await expect(panel(page).locator('.lyric-line')).toHaveCount(24)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const [width, height] of [[320, 700], [390, 844], [768, 844], [1024, 768], [1440, 900], [720, 450]]) {
    await page.setViewportSize({ width, height })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(panel(page)).toBeVisible()
    // Crossing the dock/drawer breakpoint remounts the panel. Wait for the
    // replacement to be measured rather than reading the outgoing element.
    await expect.poll(async () => {
      const bounds = await panel(page).boundingBox()
      return !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= width
    }).toBe(true)
    await expect(panel(page).getByRole('button', { name: 'Lyrics options', exact: true })).toBeVisible()
    await openOptions(page); await page.getByRole('menuitem', { name: 'Import LRC', exact: true }).press('Escape')
    await expect(panel(page).getByRole('button', { name: 'Lyrics options', exact: true })).toBeFocused()
    if (width < 1200) await expect(panel(page).getByRole('slider', { name: 'Seek', exact: true })).toBeVisible()
    if (width === 390) await page.screenshot({ path: `test-results/lyrics-mobile-${info.project.name}.png` })
  }
  expect(await panel(page).locator('.lyric-line').first().evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')
})

test('imports remain local and preserve chosen text as plain content', async ({ page }, info) => {
  await load(page, false); await start(page, info)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true }).click()
  await panel(page).getByRole('button', { name: 'Use local lyrics only', exact: true }).click()
  await panel(page).getByLabel('Import lyrics file', { exact: true }).setInputFiles({ name: 'Chosen.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00]<script>unsafe()</script>\n[00:03]A safe test line') })
  await expect(panel(page).locator('.lyric-line').first()).toHaveText('<script>unsafe()</script>')
  expect(await page.evaluate(() => typeof (window as unknown as { unsafe?: unknown }).unsafe)).toBe('undefined')
  await expect(panel(page).locator('.lyrics-source')).toContainText('Chosen.lrc')
  await panel(page).getByLabel('Import lyrics file', { exact: true }).setInputFiles({ name: 'Plain.lrc', mimeType: 'text/plain', buffer: Buffer.from('A plain test lyric\nNo invented timing') })
  await expect(panel(page).locator('.lyrics-plain')).toContainText('no timing available')
  await expect(panel(page).locator('.lyric-line')).toHaveCount(0)
})

test('playlist validation stays inside the dialog and offers an available name', async ({ page }) => {
  await load(page)
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  await page.getByRole('button', { name: 'Create draft', exact: true }).click()
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  await page.getByRole('button', { name: 'Create draft', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a playlist', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('already exists')
  await expect(dialog.getByRole('textbox', { name: 'Playlist name', exact: true })).toBeFocused()
  await expect(dialog.getByRole('textbox', { name: 'Playlist name', exact: true })).toHaveAttribute('aria-invalid', 'true')
  await dialog.getByRole('button', { name: 'Use an available name', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Playlist name', exact: true })).toHaveValue('My playlist 2')
  await dialog.getByRole('button', { name: 'Create draft', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'My playlist 2', exact: true })).toBeVisible()
})
