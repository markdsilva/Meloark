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
for (const numbered of [false, true]) test(`native folder rename ${numbered ? 'numbered' : 'unnumbered'}, guided setup, dependent playlists, sidecars, playback and reload`, async ({ playwright }, info) => {
  test.skip(info.project.name !== 'chromium' || process.platform !== 'linux' || process.env.MELOARK_NATIVE_SYNC_TEST !== '1', 'Opt-in Linux native picker test needs X11/xdotool and only uses disposable files; Windows acceptance is manual.')
  test.setTimeout(90000)
  const directory = await mkdtemp(join(tmpdir(), 'meloark-native-sync-'))
  const profile = await mkdtemp(join(tmpdir(), 'meloark-native-profile-'))
  const codec = numbered ? 'flac' : 'wav'
  const audio = new Map(['Alpha', 'Beta', 'Gamma'].map((name, i) => [name, Buffer.from(wavSample(8 + i))]))
  const prefix = (number: number) => String(number).padStart(numbered ? 3 : 2, '0')
  const originalName = (name: string) => numbered ? `${String(['Alpha', 'Beta', 'Gamma'].indexOf(name) + 1).padStart(3, '0')} - ${name}` : name
  for (const [name, bytes] of audio) {
    const target = join(directory, `${originalName(name)}.${codec}`)
    if (codec === 'flac') {
      const input = join(directory, '.encoding-input.wav')
      await writeFile(input, bytes)
      await execute('ffmpeg', ['-v', 'error', '-y', '-i', input, '-metadata', `title=${name}`, '-metadata', 'artist=Meloark fixture', target])
      audio.set(name, await readFile(target))
      await rm(input)
    } else await writeFile(target, bytes)
  }
  await writeFile(join(directory, `${originalName('Alpha')}.lrc`), '[00:00]A local lyric\n')
  await writeFile(join(directory, 'Other.m3u8'), `#EXTM3U\r\n#keep this comment\r\n${originalName('Alpha')}.${codec}\r\n${originalName('Alpha')}.${codec}\r\n${originalName('Beta')}.${codec}\r\n`)
  const browser = await playwright.chromium.launchPersistentContext(profile, { executablePath: process.env.MELOARK_CHROMIUM_EXECUTABLE, headless: false, viewport: { width: 1440, height: 1000 } })
  try {
    const page = await browser.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(info.project.use.baseURL!)
    // Observe only; this still calls the real picker and returns its native handle.
    await page.evaluate(() => {
      const picker = window.showDirectoryPicker!.bind(window)
      window.showDirectoryPicker = async options => {
        try { const handle = await picker(options); console.log('Native picker selected:', handle.name); return handle }
        catch (error) { console.log('Native picker failed:', String(error)); throw error }
      }
    })
    page.on('console', entry => { if (entry.text().startsWith('Native picker')) console.log(entry.text()) })
    await page.getByRole('button', { name: 'Choose a music folder', exact: true }).click()
    let picker = ''
    await expect.poll(async () => {
      picker = (await execute('xdotool', ['search', '--onlyvisible', '--name', '^Select a folder this site can view$']).catch(() => ({ stdout: '' }))).stdout.trim().split('\n').at(-1) ?? ''
      return picker
    }).not.toBe('')
    await execute('xdotool', ['windowactivate', '--sync', picker])
    await execute('import', ['-window', 'root', 'test-results/native-picker.png'])
    await key('ctrl+l')
    await execute('xdotool', ['type', '--clearmodifiers', '--delay', '10', directory + '/'])
    await execute('import', ['-window', 'root', 'test-results/native-picker-path.png'])
    const geometry = (await execute('xdotool', ['getwindowgeometry', '--shell', picker])).stdout
    const width = Number(geometry.match(/WIDTH=(\d+)/)![1]), height = Number(geometry.match(/HEIGHT=(\d+)/)![1])
    await execute('xdotool', ['mousemove', '--window', picker, String(width - 50), String(height - 25), 'click', '1'])
    await page.waitForTimeout(500)
    await execute('import', ['-window', 'root', 'test-results/native-picker-after-path.png'])
    await page.waitForTimeout(500)
    await execute('import', ['-window', 'root', 'test-results/native-read-permission.png'])
    await key('Tab', 'Return')
    await expect(page.getByRole('dialog', { name: `Set up ${directory.split('/').at(-1)}` })).toBeVisible()
    if (numbered) {
      // The default playlist-only setup saves the populated order and leaves
      // existing numbered audio and sidecars untouched.
      await page.getByLabel('Playlist name', { exact: true }).fill('First order')
      await page.getByRole('button', { name: 'Set up playlist', exact: true }).click()
      const expected = `#EXTM3U\n${originalName('Alpha')}.${codec}\n${originalName('Beta')}.${codec}\n${originalName('Gamma')}.${codec}\n`
      // Wait for the real write-permission prompt rather than sending its
      // acceptance key before Chrome has displayed it on a slower build.
      const window = (await execute('xdotool', ['search', '--onlyvisible', '--name', 'Meloark'])).stdout.trim().split('\n').at(-1)!
      const windowGeometry = (await execute('xdotool', ['getwindowgeometry', '--shell', window])).stdout
      const windowWidth = Number(windowGeometry.match(/WIDTH=(\d+)/)![1])
      await expect.poll(async () => {
        if (await readFile(join(directory, 'First order.m3u8'), 'utf-8').catch(() => '') === expected) return true
        // Chrome's browser-level permission bubble is outside the page DOM.
        // Accept its Save changes button on the fixed native-test viewport.
        await execute('xdotool', ['mousemove', '--window', window, String(Math.round(windowWidth / 2 + 140)), '215', 'click', '1'])
        return false
      }, { timeout: 10000 }).toBe(true)
      await expect(page.getByText('Saved to file', { exact: true })).toBeVisible()
      expect(await readFile(join(directory, 'First order.m3u8'), 'utf-8')).toBe(expected)
      expect(await readFile(join(directory, `${originalName('Alpha')}.${codec}`))).toEqual(audio.get('Alpha'))
      expect(await readdir(directory)).not.toContain('.meloark-order-sync.json')
      await page.getByRole('button', { name: 'New playlist', exact: true }).click()
    }
    await page.getByRole('radio', { name: /Numbered filenames \+ M3U8/ }).check()
    await page.getByLabel('Playlist name', { exact: true }).fill('Ordered')
    await page.getByRole('checkbox', { name: /I reviewed this folder/ }).check()
    await page.screenshot({ path: `test-results/native-sync-${codec}-preview.png`, fullPage: true })
    await page.getByRole('button', { name: numbered ? 'Enable filename sync' : 'Set up playlist', exact: true }).click()
    await page.waitForTimeout(500)
    await execute('import', ['-window', 'root', 'test-results/native-write-permission.png'])
    await key('Tab', 'Return')
    await expect(page.getByRole('status').filter({ hasText: /^Synced$/ })).toBeVisible()
    expect(await readdir(directory)).toEqual(expect.arrayContaining([`${prefix(1)} - Alpha.${codec}`, `${prefix(2)} - Beta.${codec}`, `${prefix(3)} - Gamma.${codec}`, `${prefix(1)} - Alpha.lrc`, 'Ordered.m3u8']))
    expect((await readFile(join(directory, 'Other.m3u8'))).toString()).toBe(`#EXTM3U\r\n#keep this comment\r\n${prefix(1)} - Alpha.${codec}\r\n${prefix(1)} - Alpha.${codec}\r\n${prefix(2)} - Beta.${codec}\r\n`)
    const snapshot = async () => page.evaluate(() => new Promise<{ ids: string[]; paths: string[] }>((resolve, reject) => {
      // Inspect the persisted result, including when running the minified build.
      const request = indexedDB.open('trackindex-web')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result, query = db.transaction('libraries').objectStore('libraries').getAll()
        query.onerror = () => { db.close(); reject(query.error) }
        query.onsuccess = () => {
          const library = query.result[0], session = library.sessions[library.activePlaylist]
          db.close(); resolve({ ids: Object.keys(library.tracks).sort(), paths: session.entries.map((entry: { path: string }) => entry.path) })
        }
      }
    }))
    const original = await snapshot()
    const alpha = page.locator('.track-title').filter({ hasText: /^Alpha/ }), gamma = page.locator('.track-title').filter({ hasText: /^Gamma/ })
    const from = (await alpha.boundingBox())!, to = (await gamma.boundingBox())!
    await page.mouse.move(from.x + 60, from.y + 20); await page.mouse.down(); await page.mouse.move(from.x + 60, from.y + 35, { steps: 3 }); await page.mouse.move(to.x + 60, to.y + 28, { steps: 10 }); await page.mouse.up()
    await expect(page.locator('.track-title strong')).toHaveText(['Beta', 'Gamma', 'Alpha'])
    await expect.poll(async () => (await readFile(join(directory, 'Ordered.m3u8'))).toString()).toBe(`#EXTM3U\n${prefix(1)} - Beta.${codec}\n${prefix(2)} - Gamma.${codec}\n${prefix(3)} - Alpha.${codec}\n`)
    expect(await readFile(join(directory, `${prefix(3)} - Alpha.${codec}`))).toEqual(audio.get('Alpha'))
    expect(await readFile(join(directory, `${prefix(1)} - Beta.${codec}`))).toEqual(audio.get('Beta'))
    expect(await readFile(join(directory, `${prefix(2)} - Gamma.${codec}`))).toEqual(audio.get('Gamma'))
    expect(await readFile(join(directory, `${prefix(3)} - Alpha.lrc`), 'utf-8')).toBe('[00:00]A local lyric\n')
    expect((await snapshot()).ids).toEqual(original.ids)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await snapshot()).paths).toEqual([`${prefix(1)} - Alpha.${codec}`, `${prefix(2)} - Beta.${codec}`, `${prefix(3)} - Gamma.${codec}`])
    await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.getByRole('slider', { name: 'Seek', exact: true }).fill('3')
    await expect(page.locator('.seek')).toContainText('0:03')
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await page.getByRole('row').filter({ has: alpha }).click()
    await page.getByRole('row').filter({ has: alpha }).press('Alt+ArrowDown')
    await expect.poll(async () => (await snapshot()).paths).toEqual([`${prefix(1)} - Beta.${codec}`, `${prefix(2)} - Alpha.${codec}`, `${prefix(3)} - Gamma.${codec}`])
    expect(await readFile(join(directory, `${prefix(2)} - Alpha.${codec}`))).toEqual(audio.get('Alpha'))
    // The same memory-backed audio remains seekable after a native rename.
    await page.getByRole('slider', { name: 'Seek', exact: true }).fill('4')
    await expect(page.locator('.seek')).toContainText('0:04')
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/native-sync-${codec}-desktop.png`, fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `test-results/native-sync-${codec}-mobile.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload()
    await page.getByRole('button', { name: 'Active playlist', exact: true }).click()
    await expect(page.getByText('Synced', { exact: true })).toBeVisible()
    expect((await snapshot()).ids).toEqual(original.ids)
    expect(await readdir(directory)).not.toContain('.meloark-order-sync.json')
    if (process.env.MELOARK_TEST_BUILD === '1') { expect(errors).toEqual([]); return }
    // Interrupt after a real native move, preserving the exact disk journal.
    await page.evaluate(async () => {
      const path = '/src/app/store.ts', { sources, activeLibrary } = await import(path)
      const source = sources.get(activeLibrary().id), original = source.moveFile.bind(source)
      source.moveFile = async (from: string, to: string) => { await original(from, to); throw new Error('Simulated interruption after native move') }
    })
    const first = page.getByRole('row').filter({ has: page.locator('.track-title').filter({ hasText: /^Beta/ }) })
    await first.click(); await first.press('Alt+ArrowDown')
    await expect(page.getByRole('alert')).toContainText('Simulated interruption after native move')
    expect((await readdir(directory)).some(name => name.startsWith('.meloark-') && name !== '.meloark-order-sync.json')).toBe(true)
    if (numbered) await page.evaluate(async () => {
      const path = '/src/app/store.ts', { activeLibrary, updateLibrary, persistNow } = await import(path)
      // Simulate lost browser session records, retaining only the folder binding.
      updateLibrary(activeLibrary().id, (library: object) => ({ ...library, sessions: {}, activePlaylist: undefined, tracks: {} }))
      await persistNow(true)
    })
    await page.reload()
    await page.getByRole('button', { name: 'Recover filename sync', exact: true }).click()
    await expect.poll(async () => (await readFile(join(directory, 'Ordered.m3u8'))).toString()).toBe(`#EXTM3U\n${prefix(1)} - Alpha.${codec}\n${prefix(2)} - Beta.${codec}\n${prefix(3)} - Gamma.${codec}\n`)
    await expect.poll(async () => (await readdir(directory)).some(name => name.startsWith('.meloark-'))).toBe(false)
    if (numbered) {
      await expect(page.getByRole('dialog').filter({ hasText: 'Set up' })).toBeVisible()
      await page.getByRole('button', { name: 'Browse first', exact: true }).click()
      await expect(page.locator('.track-title strong')).toHaveText(['Alpha', 'Beta', 'Gamma'])
    } else expect((await snapshot()).ids).toEqual(original.ids)
    for (const [index, name] of ['Alpha', 'Beta', 'Gamma'].entries()) expect(await readFile(join(directory, `${prefix(index + 1)} - ${name}.${codec}`))).toEqual(audio.get(name))
    expect(errors).toEqual([])
  } catch (error) {
    console.log('Native test files:', await readdir(directory))
    console.log('Native visible windows:', (await execute('xdotool', ['search', '--onlyvisible', '--name', '.']).catch(() => ({ stdout: '' }))).stdout)
    await execute('import', ['-window', 'root', 'test-results/native-display-failure.png']).catch(() => undefined)
    throw error
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }) }
})
