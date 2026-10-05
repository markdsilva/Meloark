import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm, access, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { wavSample } from '../fixtures/audio'

async function connectFixture(page: Page) {
  const directory = await mkdtemp(join(tmpdir(), 'meloark-test-'))
  const audio = Buffer.from(wavSample())
  await writeFile(join(directory, 'A.wav'), audio)
  await writeFile(join(directory, 'B.wav'), audio)
  await writeFile(join(directory, 'Local.m3u8'), '#EXTM3U\nA.wav\nB.wav\n')
  const writes: string[] = []
  await page.exposeBinding('fixtureRead', async (_source, name: string) => {
    if (!['A.wav', 'B.wav', 'Local.m3u8'].includes(name)) throw new Error('Unknown fixture file')
    return [...await readFile(join(directory, name))]
  })
  await page.exposeBinding('fixtureWrite', async (_source, name: string, bytes: number[]) => {
    if (name !== 'Local.m3u8') throw new Error('Attempted to mutate a non-playlist fixture')
    writes.push(name); await writeFile(join(directory, name), Buffer.from(bytes))
  })
  await page.exposeBinding('fixtureExists', async (_source, name: string) => {
    if (!['A.wav', 'B.wav', 'Local.m3u8'].includes(name)) throw new Error('Unknown fixture file')
    try { await access(join(directory, name)); return true } catch { return false }
  })
  await page.exposeBinding('fixtureDelete', async (_source, name: string) => {
    if (name !== 'Local.m3u8') throw new Error('Attempted to delete a non-playlist fixture')
    await unlink(join(directory, name))
  })
  await page.addInitScript(() => {
    const host = window as unknown as { fixtureRead: (name: string) => Promise<number[]>; fixtureWrite: (name: string, bytes: number[]) => Promise<void>; fixtureExists: (name: string) => Promise<boolean>; fixtureDelete: (name: string) => Promise<void>; failClose?: boolean; failDeleteVerification?: boolean }
    const handle = (name: string) => ({ kind: 'file', name,
      getFile: async () => {
        if (!await host.fixtureExists(name)) throw new DOMException('Missing fixture', host.failDeleteVerification ? 'NotAllowedError' : 'NotFoundError')
        return new File([new Uint8Array(await host.fixtureRead(name))], name, { type: name.endsWith('.wav') ? 'audio/wav' : 'audio/x-mpegurl' })
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
  await expect(page.getByRole('heading', { name: 'Local', exact: true })).toBeVisible()
  return { directory, audio, writes, cleanup: async () => {
    const target = resolve(directory), base = resolve(tmpdir()) + sep
    if (!target.startsWith(base) || !target.slice(base.length).startsWith('meloark-test-')) throw new Error('Unsafe fixture cleanup target')
    await rm(target, { recursive: true, force: true })
  } }
}
test.beforeEach(({ page }, info) => { void page; test.skip(info.project.name !== 'chromium', 'Direct filesystem capability is tested in Chromium; portable tests run on every engine.') })
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
