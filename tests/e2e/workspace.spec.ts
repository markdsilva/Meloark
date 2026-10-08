import { test, expect } from '@playwright/test'
import { wavSample } from '../fixtures/audio'
const audio = (name: string) => ({ name, mimeType: 'audio/wav', buffer: Buffer.from(wavSample()) })

test('first visit offers capabilities and preserves portable access', async ({ page }, info) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your music.*At home/ })).toBeVisible()
  if (info.project.name === 'chromium') await page.screenshot({ path: 'test-results/welcome.png', fullPage: true })
  await page.getByRole('button', { name: 'See capabilities' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('No music uploads')).toBeVisible()
  await page.getByRole('dialog').locator('summary').click()
  await expect(page.getByText('Playlist file deletion', { exact: true }).locator('..').locator('..')).toContainText(info.project.name === 'chromium' ? 'Not yet verified' : 'Unavailable')
  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page.getByRole('button', { name: 'Choose a music folder' })).toBeEnabled()
})

test('group dragging preserves relative order and Escape cancels a drag', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    ...['A', 'B', 'C', 'D', 'E'].map(name => audio(`${name}.wav`)),
    { name: 'Order.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nA.wav\nB.wav\nC.wav\nD.wav\nE.wav\n') },
  ])
  const grid = page.getByRole('grid')
  await page.getByRole('checkbox', { name: 'Select B', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Select D', exact: true }).check()
  const target = page.locator('.track-title').filter({ hasText: /^E/ })
  await target.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  const handle = page.locator('.track-title').filter({ hasText: /^B/ })
  const from = await handle.boundingBox(), to = await target.boundingBox()
  await page.mouse.move(from!.x + 7, from!.y + 7); await page.mouse.down()
  await page.mouse.move(from!.x + 7, from!.y + 20, { steps: 3 })
  await page.mouse.move(to!.x + 7, to!.y + 12, { steps: 15 })
  await expect(page.getByRole('row').filter({ has: target })).toHaveClass(/drop-target/)
  await page.mouse.up()
  await expect(grid.getByRole('row').filter({ has: page.locator('.track-title') }).locator('.track-title strong')).toHaveText(['A', 'C', 'E', 'B', 'D'])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(grid.locator('.track-title strong')).toHaveText(['A', 'B', 'C', 'D', 'E'])
  const nextFrom = await handle.boundingBox()
  await page.mouse.move(nextFrom!.x + 7, nextFrom!.y + 7); await page.mouse.down()
  await page.mouse.move(nextFrom!.x + 7, nextFrom!.y + 100, { steps: 10 })
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(grid.locator('.track-title strong')).toHaveText(['A', 'B', 'C', 'D', 'E'])
})

test('native audio plays, seeks, and follows the active draft', async ({ page }, info) => {
  test.skip(info.project.name === 'webkit' && process.platform === 'win32', 'Playwright WebKit on Windows lacks native audio decoding; macOS Safari playback needs a manual check.')
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    { name: 'Long.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavSample(8)) }, audio('Next.wav'),
    { name: 'Play.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nLong.wav\nNext.wav\n') },
  ])
  await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Seek', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('slider', { name: 'Seek', exact: true }).fill('4')
  await expect(page.locator('.seek')).toContainText('0:04')
  await page.getByRole('checkbox', { name: 'Select Long', exact: true }).check()
  await page.getByRole('button', { name: 'Remove from playlist', exact: true }).click()
  await expect(page.locator('.now-playing strong')).toHaveText('Next')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
})

test('10,000 tracks use a bounded DOM and retain selection across search', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Restoring workspace…')).toBeHidden()
  await page.evaluate(async () => {
    const storePath = '/src/app/store.ts', { useApp, bootstrap } = await import(storePath)
    await bootstrap()
    const tracks = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => {
      const id = `track-${i}`, title = `Track ${String(i + 1).padStart(5, '0')}`
      return [id, { id, path: `${title}.wav`, filename: `${title}.wav`, size: 100, lastModified: 0, index: null, metadataStatus: 'ready', metadata: { title, artist: 'Synthetic test library', album: '' }, support: 'likely' }]
    }))
    useApp.setState({ libraries: [{ id: 'large', name: 'Large library', kind: 'portable', connected: false, scanning: false, generation: 1, tracks, playlists: [], files: [], sessions: {} }], activeLibrary: 'large', view: 'library' })
  })
  await expect(page.getByRole('heading', { name: 'Large library', exact: true })).toBeVisible()
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '10001')
  expect(await page.getByRole('grid').getByRole('row').count()).toBeLessThan(35)
  await page.getByRole('textbox', { name: 'Search tracks' }).fill('Track 10000')
  await expect(page.locator('.track-title strong')).toHaveText(['Track 10000'])
  await page.getByRole('checkbox', { name: 'Select Track 10000', exact: true }).check()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
  await page.locator('.track-scroll').evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(page.getByRole('checkbox', { name: 'Select Track 10000', exact: true })).toBeChecked()
})

test('portable playlist preserves duplicates, supports history, exports, and recovers a draft', async ({ page }) => {
  const unexpectedRequests: string[] = []
  page.on('request', request => { if (!request.url().startsWith(test.info().project.use.baseURL!) && !request.url().startsWith('blob:')) unexpectedRequests.push(request.url()) })
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    audio('001 - First.wav'), audio('002 - Second.wav'),
    { name: 'Listening.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\n001 - First.wav\n002 - Second.wav\n001 - First.wav\n') },
  ])
  await expect(page.getByRole('heading', { name: 'Listening', exact: true })).toBeVisible()
  await expect(page.getByRole('grid', { name: 'Playlist track list' }).getByRole('row')).toHaveCount(4)
  await page.getByRole('checkbox', { name: 'Select First' }).first().check()
  await page.getByRole('button', { name: 'Remove from playlist' }).click()
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(3)
  await expect(page.getByText('Unsaved draft', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(4)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Listening.m3u8')
  const stream = await download.createReadStream()
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk)
  expect(Buffer.concat(chunks).toString()).toBe('#EXTM3U\n002 - Second.wav\n001 - First.wav\n')
  await expect(page.getByText('Download requested', { exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.getByText('Reconnect your music')).toBeVisible()
  await page.getByRole('button', { name: 'Active playlist' }).click()
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(3)
  expect(unexpectedRequests).toEqual([])
})

test('creation requires review of ambiguous filename ordering', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([audio('001 - A.wav'), audio('001 - B.wav'), audio('Unindexed.wav')])
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  await page.getByRole('radio', { name: /Review filename order/ }).check()
  await expect(page.getByText(/Duplicate indexes:/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create draft' })).toBeDisabled()
  await page.getByRole('checkbox', { name: /I reviewed/ }).check()
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByRole('heading', { name: 'My playlist', exact: true })).toBeVisible()
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(4)
})

test('local folder artwork loads progressively without external requests', async ({ page }) => {
  await page.goto('/')
  const cover = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4
    canvas.getContext('2d')!.fillRect(0, 0, 4, 4)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    audio('Artwork.wav'),
    { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(cover, 'base64') },
    { name: 'Art.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nArtwork.wav\n') },
  ])
  await expect(page.locator('.track-title img')).toHaveCount(1)
  await expect(page.locator('.track-title img')).toHaveAttribute('src', /^blob:/)
})
