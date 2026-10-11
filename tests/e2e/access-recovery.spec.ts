import { test, expect, type Page } from '@playwright/test'
import { wavSample } from '../fixtures/audio'
import { trackRow } from './helpers/ui'

type Fixture = { read: PermissionState; write: PermissionState; grant: boolean; requests: string[]; writes: number; missing: boolean }
// A real DirectSource exercises permission boundaries. All audio and writes are
// disposable in-memory fixtures; no user folder is involved.
async function connect(page: Page) {
  await page.goto('/')
  const cover = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32
    const context = canvas.getContext('2d')!; context.fillStyle = '#4362ad'; context.fillRect(0, 0, 32, 32)
    return canvas.toDataURL().split(',')[1]
  })
  await page.addInitScript(({ audio, cover }) => {
    const host = window as unknown as { accessFixture: Fixture }
    const state: Fixture = host.accessFixture = { read: 'granted', write: 'granted', grant: true, requests: [], writes: 0, missing: false }
    const bytes = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const files = new Map([
      ['Song.wav', new File([bytes(audio)], 'Song.wav', { type: 'audio/wav', lastModified: 0 })],
      ['Other.wav', new File([bytes(audio)], 'Other.wav', { type: 'audio/wav', lastModified: 0 })],
      ['cover.png', new File([bytes(cover)], 'cover.png', { type: 'image/png', lastModified: 0 })],
      ['Local.m3u8', new File(['#EXTM3U\nSong.wav\nOther.wav\n'], 'Local.m3u8', { lastModified: 0 })],
    ])
    const checkRead = () => { if (state.read !== 'granted') throw new DOMException('Folder permission expired', 'NotAllowedError') }
    const handle = (name: string) => ({ kind: 'file', name, getFile: async () => {
      checkRead()
      if (!files.has(name) || state.missing && name === 'Song.wav') throw new DOMException('Missing', 'NotFoundError')
      return files.get(name)!
    }, createWritable: async () => {
      if (state.write !== 'granted') throw new DOMException('Write permission expired', 'NotAllowedError')
      let staged = new Uint8Array()
      return { write: async (data: ArrayBuffer) => { staged = new Uint8Array(data) }, close: async () => { state.writes++; files.set(name, new File([staged], name)) }, abort: async () => {} }
    } })
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => ({ kind: 'directory', name: 'Access test music',
      queryPermission: async ({ mode }: { mode: string }) => mode === 'read' ? state.read : state.write,
      requestPermission: async ({ mode }: { mode: string }) => {
        state.requests.push(mode)
        if (state.grant) { state.read = 'granted'; if (mode === 'readwrite') state.write = 'granted' }
        return state.grant ? 'granted' : 'denied'
      },
      entries: async function* () { checkRead(); for (const name of files.keys()) yield [name, handle(name)] },
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        checkRead()
        if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError')
        return handle(name)
      },
    }) })
  }, { audio: Buffer.from(wavSample(30)).toString('base64'), cover })
  await page.reload()
  await page.getByRole('button', { name: 'Choose a music folder', exact: true }).click()
  await page.getByRole('button', { name: 'Browse first', exact: true }).click()
  await expect(page.locator('.track-row .artwork img')).toHaveCount(2)
}

test('expired read access prompts once, preserves playlist order, and recovers after an explicit grant', async ({ page }) => {
  await connect(page)
  await page.getByRole('tab', { name: 'Playlist', exact: true }).click()
  const before = await page.locator('.track-title strong').allTextContents()
  await page.evaluate(() => { const fixture = (window as unknown as { accessFixture: Fixture }).accessFixture; fixture.read = 'prompt'; fixture.grant = false; window.dispatchEvent(new Event('focus')) })
  const dialog = page.getByRole('dialog', { name: 'Restore folder access', exact: true })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { accessFixture: Fixture }).accessFixture.requests)).toEqual([])
  await dialog.getByRole('button', { name: 'Not now', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await dialog.getByRole('button', { name: 'Grant access', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Access was not restored')
  await page.evaluate(() => { (window as unknown as { accessFixture: Fixture }).accessFixture.grant = true })
  await dialog.getByRole('button', { name: 'Grant access', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.track-title strong')).toHaveText(before)
  await expect(page.getByText('Reconnect your music', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Play Song', exact: true }).click()
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { accessFixture: Fixture }).accessFixture.requests)).toEqual(['read', 'read'])
})

test('a denied file read prompts recovery but a missing file does not', async ({ page }) => {
  await connect(page)
  await page.evaluate(() => { (window as unknown as { accessFixture: Fixture }).accessFixture.missing = true })
  await page.getByRole('button', { name: 'Play Song', exact: true }).click()
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true })).toBeVisible() // Next available track.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true }).click()
  await page.evaluate(() => { const fixture = (window as unknown as { accessFixture: Fixture }).accessFixture; fixture.missing = false; fixture.read = 'prompt' })
  await page.getByRole('button', { name: 'Play Song', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Restore folder access', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { accessFixture: Fixture }).accessFixture.requests)).toEqual([])
})

test('recovery waits for Help, fits mobile, and remains available from the reminder', async ({ page }) => {
  await connect(page)
  await page.locator('.topbar').getByRole('button', { name: 'Browser capabilities', exact: true }).click()
  await page.evaluate(() => { (window as unknown as { accessFixture: Fixture }).accessFixture.read = 'prompt'; window.dispatchEvent(new Event('focus')) })
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByRole('dialog')).not.toContainText('Your browser no longer allows')
  await page.keyboard.press('Escape')
  const dialog = page.getByRole('dialog', { name: 'Restore folder access', exact: true })
  await expect(dialog).toBeVisible()
  await page.setViewportSize({ width: 320, height: 740 })
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.getByRole('button', { name: 'Not now', exact: true }).click()
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: 'test-results/access-recovery-mobile.png' })
})

test('write recovery keeps playback available and requires a separate Save after permission is restored', async ({ page }) => {
  await connect(page)
  await page.getByRole('tab', { name: 'Playlist', exact: true }).click()
  await trackRow(page, 'Other').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Remove from playlist', exact: true }).click()
  await page.evaluate(() => { const fixture = (window as unknown as { accessFixture: Fixture }).accessFixture; fixture.write = 'prompt'; fixture.grant = false })
  await page.getByRole('button', { name: 'Save playlist', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Restore saving access', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('can still read your music')
  await page.evaluate(() => { (window as unknown as { accessFixture: Fixture }).accessFixture.grant = true })
  await dialog.getByRole('button', { name: 'Grant write access', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { accessFixture: Fixture }).accessFixture.writes)).toBe(0)
  await page.getByRole('button', { name: 'Play Song', exact: true }).click()
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save playlist', exact: true }).click()
  await expect(page.getByText('Saved to file', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { accessFixture: Fixture }).accessFixture.writes)).toBe(1)
})

test('browser storage guidance offers retry and export without asking for folder permissions', async ({ page }) => {
  await connect(page)
  await page.getByRole('button', { name: 'Storage options', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Keep a copy of your playlist', exact: true })
  await expect(dialog).toContainText('handle could not be remembered')
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export playlist', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('Local.m3u8')
  await dialog.getByRole('button', { name: 'Retry storage', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Storage is still unavailable')
  expect(await page.evaluate(() => (window as unknown as { accessFixture: Fixture }).accessFixture.requests)).toEqual([])
  await dialog.getByRole('button', { name: 'Not now', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Storage options', exact: true })).toBeVisible()
})
