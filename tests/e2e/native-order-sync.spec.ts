import { test, expect as baseExpect } from '@playwright/test'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { wavSample } from '../fixtures/audio'

const execute = promisify(execFile)
const key = (...keys: string[]) => execute('xdotool', ['key', '--clearmodifiers', ...keys])
// Native writable-stream close and content checks can outlast the default
// five seconds on a shared runner. Keep every exact byte/state assertion and
// wait for completion, rather than assuming rename means the batch is saved.
const expect = baseExpect.configure({ timeout: 30_000 })
// The Linux CI display selects the real native folder dialog. No JS handle
// replacement, OPFS, permission override or experimental browser flag is used.
for (const numbered of [false, true]) test(`native folder rename ${numbered ? 'numbered' : 'unnumbered'}, guided setup, dependent playlists, sidecars, playback and reload`, async ({ playwright }, info) => {
  test.skip(info.project.name !== 'chromium' || process.platform !== 'linux' || process.env.MELOARK_NATIVE_SYNC_TEST !== '1', 'Opt-in Linux native picker test needs X11/xdotool and only uses disposable files; Windows acceptance is manual.')
  test.setTimeout(180_000)
  const directory = await mkdtemp(join(tmpdir(), 'meloark-native-sync-'))
  const profile = await mkdtemp(join(tmpdir(), 'meloark-native-profile-'))
  const codec = numbered ? 'flac' : 'wav'
  const authorityFile = numbered ? 'Ordered.m3u8' : 'Road trip.m3u8'
  // Keep playback on the same recording throughout a slow native write.
  const audio = new Map(['Alpha', 'Beta', 'Gamma'].map((name, i) => [name, Buffer.from(wavSample(60 + i))]))
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
  if (!numbered) await writeFile(join(directory, authorityFile), `#EXTM3U\nGamma.wav\nAlpha.wav\nBeta.wav\n`)
  const browser = await playwright.chromium.launchPersistentContext(profile, { executablePath: process.env.MELOARK_CHROMIUM_EXECUTABLE, headless: false, viewport: { width: 1440, height: 1000 } })
  const page = await browser.newPage(), errors: string[] = []
  try {
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
      }, { timeout: 30_000 }).toBe(true)
      await expect(page.getByText('Saved to file', { exact: true })).toBeVisible()
      expect(await readFile(join(directory, 'First order.m3u8'), 'utf-8')).toBe(expected)
      expect(await readFile(join(directory, `${originalName('Alpha')}.${codec}`))).toEqual(audio.get('Alpha'))
      expect(await readdir(directory)).not.toContain('.meloark-order-sync.json')
      await page.getByRole('button', { name: 'New playlist', exact: true }).click()
    }
    await page.getByRole('radio', { name: /Numbered filenames \+ M3U8/ }).check()
    if (!numbered) {
      await expect(page.getByLabel('Initial sync order', { exact: true })).toHaveValue(authorityFile)
      await expect(page.getByRole('button', { name: 'Set up playlist', exact: true })).toBeDisabled()
      await page.getByRole('radio', { name: /Use saved M3U8 order/ }).check()
    }
    await expect(page.getByRole('dialog')).toContainText(`Preview only — arrange these 3 tracks by dragging in the Playlist tab after ${numbered ? 'creating the playlist' : 'setup'}.`)
    if (numbered) await page.getByLabel('Playlist name', { exact: true }).fill('Ordered')
    await page.getByRole('checkbox', { name: /I reviewed this folder/ }).check()
    await page.screenshot({ path: `test-results/native-sync-${codec}-preview.png`, fullPage: true })
    await page.getByRole('button', { name: numbered ? 'Enable filename sync' : 'Set up playlist', exact: true }).click()
    await page.waitForTimeout(500)
    await execute('import', ['-window', 'root', 'test-results/native-write-permission.png'])
    await key('Tab', 'Return')
    await expect(page.getByRole('status').filter({ hasText: /^Synced$/ })).toBeVisible()
    async function restoreFilenameOrder() {
      const gammaRow = page.getByRole('row').filter({ has: page.locator('.track-title').filter({ hasText: /^Gamma/ }) })
      await gammaRow.click(); await gammaRow.press('Alt+ArrowDown')
      await expect(page.locator('.track-title strong')).toHaveText(['Alpha', 'Gamma', 'Beta'])
      await gammaRow.press('Alt+ArrowDown')
      await expect(page.locator('.track-title strong')).toHaveText(['Alpha', 'Beta', 'Gamma'])
      await expect(page.getByRole('status').filter({ hasText: /^Synced$/ })).toBeVisible()
      await expect.poll(async () => readFile(join(directory, authorityFile), 'utf-8')).toBe(`#EXTM3U\n${prefix(1)} - Alpha.${codec}\n${prefix(2)} - Beta.${codec}\n${prefix(3)} - Gamma.${codec}\n`)
    }
    if (!numbered) {
      await expect(page.locator('.track-title strong')).toHaveText(['Gamma', 'Alpha', 'Beta'])
      expect(await readFile(join(directory, authorityFile), 'utf-8')).toBe(`#EXTM3U\n01 - Gamma.wav\n02 - Alpha.wav\n03 - Beta.wav\n`)
      expect(await readFile(join(directory, '01 - Gamma.wav'))).toEqual(audio.get('Gamma'))
      expect((await readdir(directory)).filter(name => /\.m3u8$/.test(name)).sort()).toEqual(['Other.m3u8', authorityFile].sort())
      await restoreFilenameOrder()
    }
    // Exercise the actual external-edit review UI and native journal path.
    await writeFile(join(directory, authorityFile), `#EXTM3U\n${prefix(3)} - Gamma.${codec}\n${prefix(1)} - Alpha.${codec}\n${prefix(2)} - Beta.${codec}\n`)
    const alphaRow = page.getByRole('row').filter({ has: page.locator('.track-title').filter({ hasText: /^Alpha/ }) })
    await alphaRow.click(); await alphaRow.press('Alt+ArrowDown')
    await expect(page.getByRole('status').filter({ hasText: 'changed outside Meloark' })).toBeVisible()
    await page.getByRole('button', { name: 'Review playlist order', exact: true }).click()
    const orderReview = page.getByRole('dialog', { name: 'Review playlist order', exact: true })
    await orderReview.getByRole('radio', { name: numbered ? /Keep Meloark order/ : /Import saved M3U8 order/ }).check()
    await expect(orderReview.getByLabel('Reconciled filename preview')).toContainText(`→ ${prefix(1)} - ${numbered ? 'Beta' : 'Gamma'}.${codec}`)
    await page.setViewportSize({ width: 320, height: 844 })
    expect(await orderReview.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: `test-results/native-order-review-${codec}-mobile.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await orderReview.getByRole('checkbox', { name: /I reviewed this order/ }).check()
    await orderReview.getByRole('button', { name: 'Apply reviewed order', exact: true }).click()
    await expect(orderReview).toHaveCount(0)
    await expect(page.locator('.track-title strong')).toHaveText(numbered ? ['Beta', 'Alpha', 'Gamma'] : ['Gamma', 'Alpha', 'Beta'])
    const firstName = numbered ? 'Beta' : 'Gamma'
    expect(await readFile(join(directory, `${prefix(1)} - ${firstName}.${codec}`))).toEqual(audio.get(firstName))
    if (numbered) {
      const betaRow = page.getByRole('row').filter({ has: page.locator('.track-title').filter({ hasText: /^Beta/ }) })
      await betaRow.click(); await betaRow.press('Alt+ArrowDown')
      await expect(page.locator('.track-title strong')).toHaveText(['Alpha', 'Beta', 'Gamma'])
      await expect.poll(async () => readFile(join(directory, authorityFile), 'utf-8')).toBe(`#EXTM3U\n${prefix(1)} - Alpha.${codec}\n${prefix(2)} - Beta.${codec}\n${prefix(3)} - Gamma.${codec}\n`)
      await expect(page.getByRole('status').filter({ hasText: /^Synced$/ })).toBeVisible()
    } else await restoreFilenameOrder()
    expect(await readdir(directory)).toEqual(expect.arrayContaining([`${prefix(1)} - Alpha.${codec}`, `${prefix(2)} - Beta.${codec}`, `${prefix(3)} - Gamma.${codec}`, `${prefix(1)} - Alpha.lrc`, authorityFile]))
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
    await expect.poll(async () => (await readFile(join(directory, authorityFile))).toString()).toBe(`#EXTM3U\n${prefix(1)} - Beta.${codec}\n${prefix(2)} - Gamma.${codec}\n${prefix(3)} - Alpha.${codec}\n`)
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
    await expect(page.locator('.now-playing strong')).toHaveText('Alpha')
    await page.getByRole('row').filter({ has: alpha }).click()
    await page.getByRole('row').filter({ has: alpha }).press('Alt+ArrowDown')
    await expect.poll(async () => (await snapshot()).paths).toEqual([`${prefix(1)} - Beta.${codec}`, `${prefix(2)} - Alpha.${codec}`, `${prefix(3)} - Gamma.${codec}`])
    expect(await readFile(join(directory, `${prefix(2)} - Alpha.${codec}`))).toEqual(audio.get('Alpha'))
    // The same memory-backed audio remains seekable after a native rename.
    await page.getByRole('slider', { name: 'Seek', exact: true }).fill('4')
    await expect(page.locator('.seek')).toContainText('0:04')
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect(page.locator('.now-playing strong')).toHaveText('Alpha')
    await page.screenshot({ path: `test-results/native-sync-${codec}-desktop.png`, fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `test-results/native-sync-${codec}-mobile.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload()
    await page.getByRole('button', { name: 'Active playlist', exact: true }).click()
    await expect(page.getByText('Synced', { exact: true })).toBeVisible()
    expect((await snapshot()).ids).toEqual(original.ids)
    expect(await readdir(directory)).not.toContain('.meloark-order-sync.json')
    async function removeNumbers(order: string[], expectedIds?: string[]) {
      const synced = await page.getByRole('button', { name: 'Sync settings', exact: true }).count() > 0
      if (synced) {
        await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Pause', exact: true }).click()
        await page.getByRole('button', { name: 'Sync settings', exact: true }).click()
        await page.getByRole('button', { name: 'Remove filename numbers…', exact: true }).click()
      } else {
        await page.getByRole('button', { name: `Actions for library ${directory.split('/').at(-1)}`, exact: true }).click()
        await page.getByRole('menuitem', { name: 'Remove filename numbers…', exact: true }).click()
      }
      const dialog = page.getByRole('dialog', { name: 'Remove filename numbers', exact: true })
      await expect(dialog.getByLabel('Number removal preview')).toContainText(`→ Alpha.${codec}`)
      await expect(dialog.getByRole('button', { name: 'Remove numbers', exact: true })).toBeDisabled()
      await dialog.getByRole('checkbox', { name: /I reviewed these changes/ }).check()
      await page.screenshot({ path: `test-results/native-removal-${codec}-desktop.png`, fullPage: true })
      await page.setViewportSize({ width: 320, height: 844 })
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: `test-results/native-removal-${codec}-mobile.png`, fullPage: true })
      await page.setViewportSize({ width: 1440, height: 1000 })
      if (!numbered && process.env.MELOARK_TEST_BUILD !== '1') {
        // Interrupt removal itself after one real move, then recover after reload.
        await page.evaluate(async () => {
          const path = '/src/app/store.ts', { sources, activeLibrary } = await import(path)
          const source = sources.get(activeLibrary().id), original = source.moveFile.bind(source)
          source.moveFile = async (from: string, to: string) => { await original(from, to); throw new Error('Interrupted number removal') }
        })
        await dialog.getByRole('button', { name: 'Remove numbers', exact: true }).click()
        await expect(dialog.getByRole('alert').first()).toContainText('Interrupted number removal')
        expect(JSON.parse(await readFile(join(directory, '.meloark-order-sync.json'), 'utf-8')).operation).toBe('remove-prefixes')
        await page.reload()
        await page.getByRole('button', { name: 'Recover filename sync', exact: true }).click()
      } else await dialog.getByRole('button', { name: 'Remove numbers', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(async () => (await readdir(directory)).some(name => name.startsWith('.meloark-'))).toBe(false)
      await expect(page.getByRole('button', { name: 'Sync settings', exact: true })).toHaveCount(0)
      expect(await readFile(join(directory, authorityFile), 'utf-8')).toBe(`#EXTM3U\n${order.map(name => `${name}.${codec}\n`).join('')}`)
      expect(await readFile(join(directory, 'Other.m3u8'), 'utf-8')).toBe(`#EXTM3U\r\n#keep this comment\r\nAlpha.${codec}\r\nAlpha.${codec}\r\nBeta.${codec}\r\n`)
      expect(await readFile(join(directory, 'Alpha.lrc'), 'utf-8')).toBe('[00:00]A local lyric\n')
      for (const [name, bytes] of audio) expect(await readFile(join(directory, `${name}.${codec}`))).toEqual(bytes)
      if (synced) {
        if (process.env.MELOARK_TEST_BUILD === '1') {
          // Resume the previously loaded snapshot after its disk name changed.
          await expect(page.locator('.now-playing strong')).toHaveText(order[0])
          await page.getByRole('slider', { name: 'Seek', exact: true }).fill('2')
          await expect(page.locator('.seek')).toContainText('0:02')
          await page.getByRole('button', { name: 'Play', exact: true }).click()
        } else await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
        if (expectedIds) expect((await snapshot()).ids).toEqual(expectedIds)
      }
      await page.reload()
      expect(await readdir(directory)).not.toContain('.meloark-order-sync.json')
      if (synced) {
        await page.getByRole('button', { name: 'Active playlist', exact: true }).click()
        await expect(page.locator('.track-title strong')).toHaveText(order)
        if (expectedIds) expect((await snapshot()).ids).toEqual(expectedIds)
        const first = page.getByRole('row').filter({ has: page.locator('.track-title').filter({ hasText: new RegExp(`^${order[0]}`) }) })
        await first.click(); await first.press('Alt+ArrowDown')
        await expect(page.locator('.track-title strong')).toHaveText([order[1], order[0], order[2]])
        // Subsequent draft edits no longer number files or rewrite the M3U8.
        expect(await readFile(join(directory, authorityFile), 'utf-8')).toBe(`#EXTM3U\n${order.map(name => `${name}.${codec}\n`).join('')}`)
        await expect(page.getByText('Unsaved draft', { exact: true })).toBeVisible()
      }
      for (const [name, bytes] of audio) expect(await readFile(join(directory, `${name}.${codec}`))).toEqual(bytes)
    }
    if (process.env.MELOARK_TEST_BUILD === '1') { await removeNumbers(['Beta', 'Alpha', 'Gamma'], original.ids); expect(errors).toEqual([]); return }
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
    await expect.poll(async () => (await readFile(join(directory, authorityFile))).toString()).toBe(`#EXTM3U\n${prefix(1)} - Alpha.${codec}\n${prefix(2)} - Beta.${codec}\n${prefix(3)} - Gamma.${codec}\n`)
    await expect.poll(async () => (await readdir(directory)).some(name => name.startsWith('.meloark-'))).toBe(false)
    if (numbered) {
      await expect(page.getByRole('dialog').filter({ hasText: 'Set up' })).toBeVisible()
      await page.getByRole('button', { name: 'Browse first', exact: true }).click()
      await expect(page.locator('.track-title strong')).toHaveText(['Alpha', 'Beta', 'Gamma'])
    } else expect((await snapshot()).ids).toEqual(original.ids)
    for (const [index, name] of ['Alpha', 'Beta', 'Gamma'].entries()) expect(await readFile(join(directory, `${prefix(index + 1)} - ${name}.${codec}`))).toEqual(audio.get(name))
    await removeNumbers(['Alpha', 'Beta', 'Gamma'], numbered ? undefined : original.ids)
    expect(errors).toEqual([])
  } catch (error) {
    const files = await readdir(directory)
    console.log('Native test files:', files)
    const journal = await readFile(join(directory, '.meloark-order-sync.json'), 'utf-8').then(text => JSON.parse(text)).catch(() => null)
    const diagnostics = {
      files, pendingWrites: files.filter(name => name.endsWith('.crswap')),
      alerts: await page.getByRole('alert').allTextContents().catch(() => []),
      statuses: await page.getByRole('status').allTextContents().catch(() => []), pageErrors: errors,
      journal: journal ? { phase: journal.phase, operation: journal.operation, patches: journal.patches.map((patch: { path: string }) => patch.path) } : null,
    }
    console.log('Native completion diagnostics:', JSON.stringify(diagnostics))
    await info.attach('native-completion-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' })
    console.log('Native visible windows:', (await execute('xdotool', ['search', '--onlyvisible', '--name', '.']).catch(() => ({ stdout: '' }))).stdout)
    const display = info.outputPath('native-display-failure.png')
    await execute('import', ['-window', 'root', display]).then(() => info.attach('native-display', { path: display, contentType: 'image/png' })).catch(() => undefined)
    throw error
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }) }
})
