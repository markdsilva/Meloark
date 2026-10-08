import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { wavSample } from '../fixtures/audio'

const execute = promisify(execFile)
const key = (...keys: string[]) => execute('xdotool', ['key', '--clearmodifiers', ...keys])
// The Linux CI display selects the real native folder dialog. No JS handle
// replacement, OPFS, permission override or experimental browser flag is used.
test('native folder rename, dependent playlists, sidecars, waiting playback and reload', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'chromium' || process.platform !== 'linux' || process.env.MELOARK_NATIVE_SYNC_TEST !== '1', 'Opt-in Linux native picker test needs X11/xdotool and only uses disposable files; Windows acceptance is manual.')
  test.setTimeout(90000)
  const directory = await mkdtemp(join(tmpdir(), 'meloark-native-sync-'))
  const audio = new Map(['Alpha', 'Beta', 'Gamma'].map((name, i) => [name, Buffer.from(wavSample(8 + i))]))
  for (const [name, bytes] of audio) await writeFile(join(directory, `${name}.wav`), bytes)
  await writeFile(join(directory, 'Alpha.lrc'), '[00:00]A local lyric\n')
  await writeFile(join(directory, 'Other.m3u8'), '#EXTM3U\r\n#keep this comment\r\nAlpha.wav\r\nAlpha.wav\r\nBeta.wav\r\n')
  const browser = await playwright.chromium.launch({ executablePath: process.env.MELOARK_CHROMIUM_EXECUTABLE, headless: false })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(info.project.use.baseURL!)
    await page.getByRole('button', { name: 'Choose a music folder', exact: true }).click()
    await expect.poll(async () => (await execute('xdotool', ['search', '--onlyvisible', '--name', 'Select|Open'])).stdout.trim()).not.toBe('')
    await key('ctrl+l')
    await execute('xdotool', ['type', '--clearmodifiers', '--delay', '1', directory])
    await key('Return')
    await page.waitForTimeout(500)
    await key('alt+o')
    await page.waitForTimeout(500)
    await key('Return')
    await page.waitForTimeout(500)
    await key('Return')
    await expect(page.getByRole('button', { name: 'New playlist', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'New playlist', exact: true }).click()
    await page.getByRole('radio', { name: /Numbered filenames \+ M3U8/ }).check()
    await page.getByLabel('Playlist name', { exact: true }).fill('Ordered')
    await page.getByRole('checkbox', { name: /I reviewed this folder/ }).check()
    await page.screenshot({ path: 'test-results/native-sync-preview.png', fullPage: true })
    await page.getByRole('button', { name: 'Enable filename sync', exact: true }).click()
    await page.waitForTimeout(500)
    await key('Return')
    await expect(page.getByRole('status').filter({ hasText: /^Synced$/ })).toBeVisible()
    expect(await readdir(directory)).toEqual(expect.arrayContaining(['01 - Alpha.wav', '02 - Beta.wav', '03 - Gamma.wav', '01 - Alpha.lrc', 'Ordered.m3u8']))
    expect((await readFile(join(directory, 'Other.m3u8'))).toString()).toBe('#EXTM3U\r\n#keep this comment\r\n01 - Alpha.wav\r\n01 - Alpha.wav\r\n02 - Beta.wav\r\n')
    const snapshot = async () => page.evaluate(async () => {
      const path = '/src/app/store.ts', { activeLibrary, activeSession } = await import(path)
      return { ids: Object.keys(activeLibrary().tracks).sort(), revision: activeSession().revision, paths: activeSession().entries.map((entry: { path: string }) => entry.path) }
    })
    const original = await snapshot()
    const alpha = page.locator('.track-title').filter({ hasText: /^Alpha/ }), gamma = page.locator('.track-title').filter({ hasText: /^Gamma/ })
    const from = (await alpha.boundingBox())!, to = (await gamma.boundingBox())!
    await page.mouse.move(from.x + 60, from.y + 20); await page.mouse.down(); await page.mouse.move(from.x + 60, from.y + 35, { steps: 3 }); await page.mouse.move(to.x + 60, to.y + 28, { steps: 10 }); await page.mouse.up()
    await expect(page.locator('.track-title strong')).toHaveText(['Beta', 'Gamma', 'Alpha'])
    await expect.poll(async () => (await readFile(join(directory, 'Ordered.m3u8'))).toString()).toBe('#EXTM3U\n01 - Beta.wav\n02 - Gamma.wav\n03 - Alpha.wav\n')
    expect(await readFile(join(directory, '03 - Alpha.wav'))).toEqual(audio.get('Alpha'))
    expect(await readFile(join(directory, '01 - Beta.wav'))).toEqual(audio.get('Beta'))
    expect(await readFile(join(directory, '02 - Gamma.wav'))).toEqual(audio.get('Gamma'))
    expect(await readFile(join(directory, '03 - Alpha.lrc'), 'utf-8')).toBe('[00:00]A local lyric\n')
    expect((await snapshot()).ids).toEqual(original.ids)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await snapshot()).paths).toEqual(['01 - Alpha.wav', '02 - Beta.wav', '03 - Gamma.wav'])
    await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.getByRole('slider', { name: 'Seek', exact: true }).fill('3')
    await expect(page.locator('.seek')).toContainText('0:03')
    await page.getByRole('row').filter({ has: alpha }).click()
    await page.getByRole('row').filter({ has: alpha }).press('Alt+ArrowDown')
    await expect(page.getByText('Waiting for playback to stop', { exact: true })).toBeVisible()
    expect(await readFile(join(directory, '01 - Alpha.wav'))).toEqual(audio.get('Alpha'))
    await page.getByRole('button', { name: 'Stop & sync', exact: true }).click()
    await expect.poll(async () => (await snapshot()).paths).toEqual(['01 - Beta.wav', '02 - Alpha.wav', '03 - Gamma.wav'])
    await page.screenshot({ path: 'test-results/native-sync-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/native-sync-mobile.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload()
    await page.getByRole('button', { name: 'Active playlist', exact: true }).click()
    await expect(page.getByText('Synced', { exact: true })).toBeVisible()
    expect((await snapshot()).ids).toEqual(original.ids)
    expect(await readdir(directory)).not.toContain('.meloark-order-sync.json')
    expect(errors).toEqual([])
  } catch (error) {
    console.log('Native test files:', await readdir(directory))
    console.log('Native visible windows:', (await execute('xdotool', ['search', '--onlyvisible', '--name', '.'])).stdout)
    await execute('import', ['-window', 'root', 'test-results/native-display-failure.png']).catch(() => undefined)
    throw error
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }) }
})
