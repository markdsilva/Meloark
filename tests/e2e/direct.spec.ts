import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm, access, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { wavSample } from '../fixtures/audio'

async function connectFixture(page: Page, options: { playlist?: string; browse?: boolean; audioSeconds?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'meloark-test-'))
  const audio = Buffer.from(wavSample(options.audioSeconds ?? 1))
  await writeFile(join(directory, 'A.wav'), audio)
  await writeFile(join(directory, 'B.wav'), audio)
  await writeFile(join(directory, 'Local.m3u8'), options.playlist ?? '#EXTM3U\nA.wav\nB.wav\n')
  const writes: string[] = []
  await page.exposeBinding('fixtureRead', async (_source, name: string) => {
    if (!['A.wav', 'B.wav', 'Local.m3u8'].includes(name)) throw new Error('Unknown fixture file')
    // Transfer one encoded string instead of serializing every audio byte as a
    // protocol argument; the longer playback fixture otherwise delays scanning.
    return (await readFile(join(directory, name))).toString('base64')
  })
  await page.exposeBinding('fixtureWrite', async (_source, name: string, bytes: number[]) => {
    if (name !== 'Local.m3u8') throw new Error('Attempted to mutate a non-playlist fixture')
    writes.push(name); await writeFile(join(directory, name), Buffer.from(bytes))
  })
  await page.exposeBinding('fixtureExists', async (_source, name: string) => {
    if (name === '.meloark-order-sync.json') return false
    if (!['A.wav', 'B.wav', 'Local.m3u8'].includes(name)) throw new Error('Unknown fixture file')
    try { await access(join(directory, name)); return true } catch { return false }
  })
  await page.exposeBinding('fixtureDelete', async (_source, name: string) => {
    if (name !== 'Local.m3u8') throw new Error('Attempted to delete a non-playlist fixture')
    await unlink(join(directory, name))
  })
  await page.addInitScript(() => {
    const host = window as unknown as { fixtureRead: (name: string) => Promise<string>; fixtureWrite: (name: string, bytes: number[]) => Promise<void>; fixtureExists: (name: string) => Promise<boolean>; fixtureDelete: (name: string) => Promise<void>; failClose?: boolean; failDeleteVerification?: boolean }
    const handle = (name: string) => ({ kind: 'file', name,
      getFile: async () => {
        if (!await host.fixtureExists(name)) throw new DOMException('Missing fixture', host.failDeleteVerification ? 'NotAllowedError' : 'NotFoundError')
        const bytes = Uint8Array.from(atob(await host.fixtureRead(name)), value => value.charCodeAt(0))
        return new File([bytes], name, { type: name.endsWith('.wav') ? 'audio/wav' : 'audio/x-mpegurl' })
      },
      createWritable: async () => {
        let staged = new Uint8Array()
        return { write: async (bytes: ArrayBuffer) => { staged = new Uint8Array(bytes) }, close: async () => {
          await host.fixtureWrite(name, [...staged]); if (host.failClose) throw new DOMException('Simulated close failure', 'AbortError')
        }, abort: async () => {} }
      },
    })
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => ({ name: 'Temporary test library', kind: 'directory',
      queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      entries: async function* () { for (const name of ['A.wav', 'B.wav', 'Local.m3u8']) if (await host.fixtureExists(name)) yield [name, handle(name)] },
      getFileHandle: async (name: string) => {
        if (!await host.fixtureExists(name)) throw new DOMException('Missing fixture', host.failDeleteVerification ? 'NotAllowedError' : 'NotFoundError')
        return handle(name)
      },
      removeEntry: async (name: string, options: { recursive?: boolean }) => { if (options.recursive) throw new Error('Recursive deletion is forbidden'); await host.fixtureDelete(name) },
    }) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Choose a music folder' }).click()
  await expect(page.getByRole('dialog', { name: 'Set up Temporary test library' })).toBeVisible()
  if (options.browse !== false) {
    await page.getByRole('button', { name: 'Browse first', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Local', exact: true })).toBeVisible()
  }
  return { directory, audio, writes, cleanup: async () => {
    const target = resolve(directory), base = resolve(tmpdir()) + sep
    if (!target.startsWith(base) || !target.slice(base.length).startsWith('meloark-test-')) throw new Error('Unsafe fixture cleanup target')
    await rm(target, { recursive: true, force: true })
  } }
}
test.beforeEach(({ page }, info) => { void page; test.skip(info.project.name !== 'chromium', 'Direct filesystem capability is tested in Chromium; portable tests run on every engine.') })
test('sync choices preview cleanly on desktop/mobile and a failed native capability leaves music unchanged', async ({ page }) => {
  const fixture = await connectFixture(page, { browse: false })
  try {
    // Switching from the saved playlist's one-line preview must reserve room
    // for both the original filename and its proposed replacement.
    await expect(page.getByLabel('Playlist order preview')).toBeVisible()
    for (let pass = 0; pass < 2; pass++) {
      await page.getByRole('radio', { name: /Numbered filenames \+ M3U8/ }).check()
      const rows = page.getByLabel('Filename changes preview').locator(':scope > div > div')
      await expect(rows).toHaveCount(2)
      await expect.poll(() => rows.first().evaluate(element => {
        const bounds = element.getBoundingClientRect(), target = element.querySelector('small')!.getBoundingClientRect()
        return bounds.height >= 58 && target.bottom <= bounds.bottom
      })).toBe(true)
      await page.getByRole('radio', { name: 'M3U8 only', exact: false }).check()
      await expect.poll(() => page.getByLabel('Playlist order preview').locator(':scope > div').evaluate(element => element.getBoundingClientRect().height)).toBe(84)
    }
    await page.getByRole('button', { name: 'Browse first', exact: true }).click()
    await page.evaluate(async () => {
      const path = '/src/app/store.ts', { sources, activeLibrary } = await import(path)
      sources.get(activeLibrary().id).probeRename = async () => { throw new Error('This browser does not provide native file renaming. Use M3U8-only mode.') }
    })
    await page.getByRole('button', { name: 'New playlist', exact: true }).click()
    await page.getByRole('radio', { name: /Numbered filenames \+ M3U8/ }).check()
    await expect(page.getByRole('dialog')).toContainText('Preview only — arrange these 2 tracks by dragging in the Playlist tab after creating the playlist.')
    await expect(page.getByLabel('Filename changes preview')).toContainText('01 - A.wav')
    await page.getByLabel('Initial sync order', { exact: true }).selectOption('Local.m3u8')
    await expect(page.getByLabel('Order-authority playlist', { exact: true })).toHaveValue('Local.m3u8')
    await expect(page.getByLabel('Order-authority playlist', { exact: true })).toHaveAttribute('readonly', '')
    await page.getByLabel('Initial sync order', { exact: true }).selectOption('')
    await expect(page.getByLabel('Playlist name', { exact: true })).toHaveValue('My playlist')
    await expect(page.getByRole('button', { name: 'Enable filename sync', exact: true })).toBeDisabled()
    await page.getByRole('checkbox', { name: /I reviewed this folder/ }).check()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: 'test-results/sync-choices-desktop.png', fullPage: true })
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      const dialog = page.getByRole('dialog', { name: 'Create a playlist', exact: true })
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    await page.screenshot({ path: 'test-results/sync-choices-mobile.png', fullPage: true })
    await page.getByRole('button', { name: 'Enable filename sync', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('does not provide native file renaming')
    expect(fixture.writes).toEqual([])
    expect(await readFile(join(fixture.directory, 'A.wav'))).toEqual(fixture.audio)
    expect(await readFile(join(fixture.directory, 'B.wav'))).toEqual(fixture.audio)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.track-title strong')).toHaveText(['A', 'B'])
  } finally { await fixture.cleanup() }
})
test('direct save verifies a temporary playlist and leaves audio bytes untouched', async ({ page }) => {
  const fixture = await connectFixture(page)
  try {
    await page.getByRole('checkbox', { name: 'Select A', exact: true }).check()
    await page.getByRole('button', { name: 'Remove from playlist', exact: true }).click()
    await page.getByRole('button', { name: 'Save playlist', exact: true }).click()
    await expect(page.getByText('Saved to file', { exact: true })).toBeVisible()
    expect((await readFile(join(fixture.directory, 'Local.m3u8'))).toString()).toBe('#EXTM3U\nB.wav\n')
    expect(await readFile(join(fixture.directory, 'A.wav'))).toEqual(fixture.audio)
    expect(await readFile(join(fixture.directory, 'B.wav'))).toEqual(fixture.audio)
    expect(fixture.writes).toEqual(['Local.m3u8'])
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByText('Unsaved draft', { exact: true })).toBeVisible()
    expect(fixture.writes).toHaveLength(1)
  } finally { await fixture.cleanup() }
})
test('number removal requires a fresh confirmation when its preview changes, blocks collisions and can be cancelled', async ({ page }) => {
  // Keep playback active until the explicit stop, including with animated controls
  // and a slower shared runner. A one-second sample can finish between assertions.
  const fixture = await connectFixture(page, { audioSeconds: 8 })
  try {
    await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    // Model scanned numbered filenames for this UI-only check. No native
    // rename is attempted; the real disk cases are in native-order-sync.
    const changeNames = async (names: string[]) => page.evaluate(async names => {
      const path = '/src/app/store.ts', { activeLibrary, updateLibrary } = await import(path)
      updateLibrary(activeLibrary().id, (library: { tracks: Record<string, { path: string; filename: string }>; files: string[] }) => {
        const renamed = new Map(Object.entries(library.tracks).map(([id, track], i) => [track.path, { id, path: names[i] }]))
        return { ...library, files: library.files.map(path => renamed.get(path)?.path ?? path), tracks: Object.fromEntries(Object.entries(library.tracks).map(([id, track], i) => [id, { ...track, path: names[i], filename: names[i] }])) }
      })
    }, names)
    await changeNames(['01 - A.wav', '02 - B.wav'])
    await page.getByRole('button', { name: /^Actions for library / }).click()
    await page.getByRole('menuitem', { name: 'Remove filename numbers…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove filename numbers', exact: true })
    const checkbox = dialog.getByRole('checkbox', { name: /I reviewed these changes/ }), remove = dialog.getByRole('button', { name: 'Remove numbers', exact: true })
    await expect(remove).toBeDisabled()
    await expect(checkbox).toBeDisabled()
    await dialog.getByRole('button', { name: 'Stop playback', exact: true }).click()
    await checkbox.check(); await expect(remove).toBeEnabled()
    await changeNames(['03 - A.wav', '02 - B.wav'])
    await expect(dialog.getByLabel('Number removal preview')).toContainText('03 - A.wav')
    await expect(checkbox).not.toBeChecked(); await expect(remove).toBeDisabled()
    await checkbox.check(); await expect(remove).toBeEnabled()
    await changeNames(['03 - Same.wav', '02 - Same.wav'])
    await expect(dialog.getByRole('alert')).toContainText('duplicate filenames')
    await expect(remove).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(fixture.writes).toEqual([])
    expect(await readFile(join(fixture.directory, 'A.wav'))).toEqual(fixture.audio)
    expect(await readFile(join(fixture.directory, 'B.wav'))).toEqual(fixture.audio)
  } finally { await fixture.cleanup() }
})
test('external edits cause a conflict without overwriting the source', async ({ page }) => {
  const fixture = await connectFixture(page)
  try {
    await page.getByRole('checkbox', { name: 'Select A', exact: true }).check()
    await page.getByRole('button', { name: 'Remove from playlist', exact: true }).click()
    const external = '#EXTM3U\nA.wav\nA.wav\n'
    await writeFile(join(fixture.directory, 'Local.m3u8'), external)
    await page.getByRole('button', { name: 'Save playlist', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('changed outside Meloark')
    expect(fixture.writes).toHaveLength(0)
    expect((await readFile(join(fixture.directory, 'Local.m3u8'))).toString()).toBe(external)
  } finally { await fixture.cleanup() }
})
test('an uncertain close is reconciled against actual file contents', async ({ page }) => {
  const fixture = await connectFixture(page)
  try {
    await page.evaluate(() => { (window as unknown as { failClose: boolean }).failClose = true })
    await page.getByRole('checkbox', { name: 'Select A', exact: true }).check()
    await page.getByRole('button', { name: 'Remove from playlist', exact: true }).click()
    await page.getByRole('button', { name: 'Save playlist', exact: true }).click()
    await expect(page.getByText('Save unverified', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
    await expect(page.getByText('Saved to file', { exact: true })).toBeVisible()
    expect(fixture.writes).toHaveLength(1)
  } finally { await fixture.cleanup() }
})

test('confirmed playlist deletion removes only the disposable playlist file', async ({ page }) => {
  const fixture = await connectFixture(page)
  try {
    await page.getByRole('button', { name: 'Actions for playlist Local.m3u8', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Delete playlist file', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete playlist file?', exact: true })
    await expect(dialog).toContainText('Local.m3u8')
    await dialog.getByRole('button', { name: 'Delete playlist file', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.playlist-row')).toHaveCount(0)
    await expect(access(join(fixture.directory, 'Local.m3u8'))).rejects.toThrow()
    expect(await readFile(join(fixture.directory, 'A.wav'))).toEqual(fixture.audio)
    expect(await readFile(join(fixture.directory, 'B.wav'))).toEqual(fixture.audio)
  } finally { await fixture.cleanup() }
})

test('deletion conflicts preserve the changed file and uncertain deletion reconciles', async ({ page }) => {
  const fixture = await connectFixture(page)
  try {
    await page.getByRole('button', { name: 'Actions for playlist Local.m3u8', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Delete playlist file', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete playlist file?', exact: true })
    const confirm = dialog.getByRole('button', { name: 'Delete playlist file', exact: true })
    await expect(confirm).toBeEnabled()
    const original = '#EXTM3U\nA.wav\nB.wav\n', changed = '#EXTM3U\nB.wav\n'
    await writeFile(join(fixture.directory, 'Local.m3u8'), changed); await confirm.click()
    await expect(dialog.getByRole('alert')).toContainText('changed outside')
    expect((await readFile(join(fixture.directory, 'Local.m3u8'))).toString()).toBe(changed)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await writeFile(join(fixture.directory, 'Local.m3u8'), original)
    await page.getByRole('button', { name: 'Actions for playlist Local.m3u8', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Delete playlist file', exact: true }).click()
    await expect(confirm).toBeEnabled()
    await page.evaluate(() => { (window as unknown as { failDeleteVerification: boolean }).failDeleteVerification = true })
    await confirm.click(); await expect(dialog.getByRole('alert')).toContainText('could not be verified')
    await expect(page.locator('.playlist-row')).toHaveCount(1)
    await page.evaluate(() => { (window as unknown as { failDeleteVerification: boolean }).failDeleteVerification = false })
    await dialog.getByRole('button', { name: 'Reconcile deletion', exact: true }).click()
    await expect(dialog).toHaveCount(0); await expect(page.locator('.playlist-row')).toHaveCount(0)
  } finally { await fixture.cleanup() }
})


test('setup reuses a differently named playlist and requires a choice when its order conflicts with filenames', async ({ page }) => {
  const fixture = await connectFixture(page, { playlist: '#EXTM3U\nB.wav\nA.wav\n', browse: false })
  try {
    const dialog = page.getByRole('dialog', { name: 'Set up Temporary test library' })
    await expect(dialog.getByLabel('Playlist file', { exact: true })).toHaveValue('Local.m3u8')
    await expect(dialog).toContainText('saved M3U8 order differs from filename order')
    await dialog.getByRole('radio', { name: /Numbered filenames \+ M3U8/ }).check()
    await expect(dialog.getByRole('button', { name: 'Set up playlist', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('checkbox', { name: /I reviewed this folder/ })).toBeDisabled()
    await dialog.getByRole('radio', { name: /Use saved M3U8 order/ }).check()
    await expect(dialog.getByLabel('Filename changes preview')).toContainText('01 - B.wav')
    await dialog.getByRole('checkbox', { name: /I reviewed this folder/ }).check()
    await expect(dialog.getByRole('button', { name: 'Set up playlist', exact: true })).toBeEnabled()
    await dialog.getByRole('radio', { name: /Use filename order/ }).check()
    await expect(dialog.getByRole('checkbox', { name: /I reviewed this folder/ })).not.toBeChecked()
    await expect(dialog.getByLabel('Filename changes preview')).toContainText('01 - A.wav')
    await dialog.getByRole('radio', { name: /M3U8 only/ }).check()
    await dialog.getByRole('button', { name: 'Use existing playlist', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.track-title strong')).toHaveText(['B', 'A'])
    expect(fixture.writes).toEqual([])
    expect(await readFile(join(fixture.directory, 'Local.m3u8'), 'utf-8')).toBe('#EXTM3U\nB.wav\nA.wav\n')
    expect(await readFile(join(fixture.directory, 'A.wav'))).toEqual(fixture.audio)
    expect(await readFile(join(fixture.directory, 'B.wav'))).toEqual(fixture.audio)
    await page.getByRole('button', { name: 'New playlist', exact: true }).click()
    await page.getByRole('radio', { name: /Numbered filenames \+ M3U8/ }).check()
    await page.getByLabel('Initial sync order', { exact: true }).selectOption('Local.m3u8')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.track-title strong')).toHaveText(['B', 'A'])
  } finally { await fixture.cleanup() }
})
