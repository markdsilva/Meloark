import { trackRow } from './helpers/ui'
import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wavSample } from '../fixtures/audio'
import { oggFlacFrames } from '../fixtures/encoded'

async function load(page: Page, seconds = 8) {
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    ...['First', 'Second', 'Third'].map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(wavSample(seconds)) })),
    { name: 'Listening.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nFirst.wav\nSecond.wav\nThird.wav\n') },
  ])
  await expect(page.getByRole('heading', { name: 'Listening', exact: true })).toBeVisible()
}
const surface = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))

test('the local analysis worker handles Ogg FLAC timing and seeks without a decoder', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles({ name: 'Lossless.ogg', mimeType: 'audio/ogg', buffer: Buffer.from(oggFlacFrames(true, 1024)) })
  const samples = await page.evaluate(async () => {
    const file = document.querySelector<HTMLInputElement>('input[aria-label="Select library files"]')!.files![0]
    const worker = new Worker('/src/metadata/bitrate.worker.ts', { type: 'module' })
    try {
      const values: number[] = []
      for (const [index, position] of [0.1, 20, 0.1].entries()) {
        values.push(await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Analysis exceeded its request watchdog.')), 5000)
          worker.onmessage = event => { clearTimeout(timer); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.sample.bitrate) }
          worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)) }
          worker.postMessage({ id: index + 1, key: 'fixture', file: index === 0 ? file : undefined, position })
        }))
      }
      return values
    } finally { worker.terminate() }
  })
  expect(samples[1]).toBeGreaterThan(samples[0]); expect(samples[2]).toBe(samples[0])
})

test('transport and filter toggles retain distinct state on hover and keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await load(page)
  const shuffle = page.getByRole('button', { name: 'Shuffle', exact: true })
  await shuffle.hover(); const off = await surface(page, 'Shuffle')
  await shuffle.click(); await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  const on = await surface(page, 'Shuffle'); expect(on).not.toEqual(off)
  await shuffle.focus(); await page.keyboard.press('Space'); await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Repeat: off', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Repeat: all', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Repeat: all', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Repeat: one', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Repeat: one', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Repeat: off', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Mute', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const filters = page.getByRole('button', { name: 'Track filters', exact: true })
  await filters.hover(); const before = await surface(page, 'Track filters'); await filters.click()
  await expect(filters).toHaveAttribute('aria-expanded', 'true'); expect(await surface(page, 'Track filters')).not.toEqual(before)
  const exportButton = page.getByRole('button', { name: 'Export', exact: true }); await exportButton.hover()
  await page.mouse.down(); expect(await exportButton.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none'); await page.mouse.up()
})

test('desktop collapse persists and rail keeps library selection reachable', async ({ page }) => {
  await load(page)
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect(page.locator('.app')).toHaveClass(/collapsed/)
  await page.getByRole('button', { name: 'Libraries and playlists', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape')
  await page.reload(); await expect(page.locator('.app')).toHaveClass(/collapsed/)
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click(); await expect(page.locator('.app')).not.toHaveClass(/collapsed/)
})

test('mobile navigation, group editing, and expanded player share transport state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await load(page)
  const open = page.getByRole('button', { name: 'Toggle navigation', exact: true }); await open.click()
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible()
  await page.keyboard.press('Escape'); await expect(open).toBeFocused()
  await page.getByRole('button', { name: 'Select tracks', exact: true }).click()
  await trackRow(page, 'First').click({ modifiers: ['ControlOrMeta'] })
  await trackRow(page, 'Second').click({ modifiers: ['ControlOrMeta'] })
  await trackRow(page, 'First').press('Alt+ArrowDown')
  await expect(page.locator('.track-title strong')).toHaveText(['Third', 'First', 'Second'])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.track-title strong')).toHaveText(['First', 'Second', 'Third'])
  await page.getByRole('button', { name: 'Expand player', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Now playing', exact: true })
  await sheet.getByRole('button', { name: 'Shuffle', exact: true }).click(); await sheet.getByRole('button', { name: 'Repeat: off', exact: true }).click()
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole('button', { name: 'More player controls', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Shuffle', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Repeat: all', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('workspace and capability cards fit narrow, landscape, and zoom-equivalent viewports', async ({ page }, info) => {
  test.setTimeout(60000)
  await load(page)
  for (const [width, height] of [[320, 640], [390, 844], [768, 1024], [1024, 768], [1440, 900], [844, 390], [720, 450]]) {
    await page.setViewportSize({ width, height })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
    const mobile = width < 768
    if (mobile) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click()
    await (mobile ? page.getByRole('dialog', { name: 'Navigation', exact: true }) : page.getByRole('main')).getByRole('button', { name: 'Browser capabilities', exact: true }).click()
    await expect(page.getByText('Save playlists to a folder', { exact: true })).toBeVisible()
    expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await page.getByRole('dialog').locator('summary').click()
    await expect(page.getByText('Playlist export', { exact: true })).toBeVisible()
    expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Got it', exact: true }).click()
    if (info.project.name === 'chromium' && [390, 1440].includes(width)) await page.screenshot({ path: `test-results/workspace-${width}.png`, fullPage: true })
  }
})

test('static details and visible live PCM analysis do not interrupt native playback', async ({ page }, info) => {
  test.skip(info.project.name === 'webkit' && process.platform === 'win32', 'Windows WebKit has no native audio decoder.')
  await page.setViewportSize({ width: 1440, height: 900 }); await load(page, 30)
  await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
  await expect(page.locator('.player-audio .live-readout')).toContainText('Constant 128 kb/s')
  await page.getByRole('button', { name: 'Audio details', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Audio details', exact: true })
  await expect(details.getByText('8 kHz', { exact: true })).toBeVisible()
  await expect(details.getByText('16-bit', { exact: true })).toBeVisible()
  await expect(details.getByText('128 kb/s', { exact: true }).first()).toBeVisible()
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.getByRole('slider', { name: 'Seek', exact: true }).fill('4')
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Expand player', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Now playing', exact: true })
  await expect(sheet.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  expect(Number(await sheet.getByRole('slider', { name: 'Seek', exact: true }).inputValue())).toBeGreaterThanOrEqual(4)
  await sheet.locator('summary').click(); await expect(sheet.locator('.live-readout')).toHaveCount(0)
  await sheet.locator('summary').click(); await expect(sheet.locator('.live-readout')).toContainText('Constant 128 kb/s')
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  expect(Number(await page.getByRole('slider', { name: 'Seek', exact: true }).inputValue())).toBeGreaterThanOrEqual(4)
})

test('empty and reviewed multi-folder creation reject duplicate names and recover after reselection', async ({ page }) => {
  await page.addInitScript(() => { window.showDirectoryPicker = undefined })
  const root = await mkdtemp(join(tmpdir(), 'meloark-review-'))
  try {
    for (const folder of ['One', 'Two']) { await mkdir(join(root, folder)); await writeFile(join(root, folder, '001 - Song.wav'), wavSample()); await writeFile(join(root, folder, 'Unindexed.wav'), wavSample()) }
    await page.goto('/'); await page.getByLabel('Select library folder', { exact: true }).setInputFiles(root)
    await expect(page.getByRole('dialog').filter({ hasText: 'Set up' })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Numbered filenames only/ })).toBeDisabled()
    await page.getByRole('button', { name: 'Browse first', exact: true }).click()
    await page.getByRole('button', { name: 'New playlist', exact: true }).click(); await page.getByLabel('Playlist name', { exact: true }).fill('Empty')
    await page.getByRole('button', { name: 'Create draft', exact: true }).click(); await expect(page.getByText('Playlist is empty')).toBeVisible()
    await page.getByRole('button', { name: 'New playlist', exact: true }).click(); await page.getByLabel('Playlist name', { exact: true }).fill('Empty'); await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible(); await page.getByLabel('Playlist name', { exact: true }).fill('Reviewed')
    await page.getByRole('radio', { name: /Review filename order/ }).check(); await expect(page.getByText(/2 folders are grouped/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create draft', exact: true })).toBeDisabled()
    await page.getByRole('checkbox', { name: /I reviewed/ }).check(); await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '5')
    await page.waitForTimeout(500); await page.reload(); await expect(page.getByText('Reconnect your music')).toBeVisible()
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Reselect folder', exact: true }).click(); await (await chooser).setFiles(root)
    await page.getByRole('button', { name: 'Active playlist', exact: true }).click(); await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '5')
  } finally { await rm(root, { recursive: true, force: true }) }
})
