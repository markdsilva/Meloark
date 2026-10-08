import { test, expect } from '@playwright/test'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

// Opt-in, read-only acceptance test. CI uses generated fixtures instead.
const directory = process.env.MELOARK_LOCAL_LIBRARY
async function inventory(root: string, folder = root): Promise<{ path: string; size: number; modified: number }[]> {
  const entries = await readdir(folder, { withFileTypes: true }), result = []
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) result.push(...await inventory(root, path))
    else if (entry.isFile()) { const info = await stat(path); result.push({ path: relative(root, path), size: info.size, modified: info.mtimeMs }) }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}
test('optional local-library scan, metadata, playback, review, export, and recovery', async ({ page }, info) => {
  test.skip(!directory || info.project.name !== 'chromium', 'Set MELOARK_LOCAL_LIBRARY to run this read-only Chromium acceptance test.')
  test.setTimeout(120000)
  const before = await inventory(directory!)
  const audioCount = before.filter(file => /\.(flac|mp3|m4a|m4b|aac|ogg|opus|wav|aiff?|wma)$/i.test(file.path)).length
  const external: string[] = []
  page.on('request', request => { if (!request.url().startsWith(info.project.use.baseURL!) && !request.url().startsWith('blob:')) external.push(request.url()) })
  await page.addInitScript(() => { window.showDirectoryPicker = undefined })
  try {
    await page.goto('/'); await page.getByLabel('Select library folder', { exact: true }).setInputFiles(directory!)
    await page.getByRole('button', { name: 'Browse first', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => { const path = '/src/app/store.ts'; const { useApp } = await import(path); return Object.keys(useApp.getState().libraries[0]?.tracks ?? {}).length }), { timeout: 60000 }).toBe(audioCount)
    await expect.poll(() => page.evaluate(async () => { const path = '/src/app/store.ts'; const { useApp } = await import(path); const tracks = Object.values(useApp.getState().libraries[0]?.tracks ?? {}) as { metadata: { technicalVersion?: number; error?: string } }[]; return tracks.filter(track => track.metadata.technicalVersion === 1 && !track.metadata.error).length }), { timeout: 60000 }).toBe(audioCount)
    await page.getByRole('button', { name: 'New playlist', exact: true }).click(); await page.getByLabel('Playlist name', { exact: true }).fill('Read-only acceptance')
    await page.getByRole('radio', { name: /Review filename order/ }).check(); await page.getByRole('checkbox', { name: /I reviewed/ }).check(); await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', String(audioCount + 1))
    await page.getByRole('button', { name: 'Mute', exact: true }).click(); await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
    for (const format of ['flac', 'mp3', 'm4a']) {
      const found = await page.evaluate(async format => {
        const storePath = '/src/app/store.ts', playerPath = '/src/playback/player.ts'
        const { useApp } = await import(storePath), { player } = await import(playerPath)
        const library = useApp.getState().libraries[0], session = library.sessions[library.activePlaylist]
        const entry = session.entries.find((entry: { trackId: string }) => library.tracks[entry.trackId]?.path.toLowerCase().endsWith(`.${format}`))
        if (!entry) return false
        player.queue.start(entry.id); await player.play(entry.id); return true
      }, format)
      if (!found) continue
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
      await expect(page.locator('.player-audio .live-readout')).toContainText(/(Live|Constant) [\d,]+ kb\/s/)
      await page.getByRole('button', { name: 'Pause', exact: true }).click(); await page.getByRole('slider', { name: 'Seek', exact: true }).fill('4')
      await expect(page.locator('.seek')).toContainText('0:04')
    }
    // Original fixture text tests lyrics against real native audio without
    // sending personal track metadata or writing sidecars to the library.
    await page.getByRole('contentinfo').getByRole('button', { name: 'Lyrics', exact: true }).click()
    const lyrics = page.locator('#lyrics-panel')
    await lyrics.getByLabel('Import lyrics file', { exact: true }).setInputFiles({ name: 'Acceptance.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00]Read-only acceptance line\n[00:04]Seek acceptance line') })
    await expect(lyrics.locator('.lyric-line')).toHaveCount(2)
    await lyrics.getByRole('button', { name: 'Seek to 0:04: Seek acceptance line', exact: true }).click()
    await expect(lyrics.locator('.lyric-line.current')).toHaveText('Seek acceptance line')
    await expect(page.getByRole('contentinfo').getByRole('slider', { name: 'Seek', exact: true })).toHaveValue('4')
    await page.getByRole('button', { name: 'Close lyrics', exact: true }).click()
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click()
    const stream = await (await download).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString().split('\n').filter(line => line && !line.startsWith('#'))).toHaveLength(audioCount)
    await page.waitForTimeout(500); await page.reload(); await expect(page.getByText('Reconnect your music')).toBeVisible()
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Reselect folder', exact: true }).click(); await (await chooser).setFiles(directory!)
    await page.getByRole('button', { name: 'Active playlist', exact: true }).click(); await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', String(audioCount + 1))
    expect(external).toEqual([])
    await info.attach('read-only-library-check', { body: JSON.stringify({ tracks: audioCount, externalRequests: external.length, unchanged: true }), contentType: 'application/json' })
  } finally { expect(await inventory(directory!)).toEqual(before) }
})
