import { test, expect } from '@playwright/test'
import { taggedWav } from '../fixtures/audio'
import { selectValue, trackRow } from './helpers/ui'

async function library(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    ...['Alpha', 'Beta', 'Charlie'].map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(taggedWav(60, { title: name, artist: name === 'Beta' ? 'Other artist' : 'Test artist', album: 'Test album' })) })),
    { name: 'Mix.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nAlpha.wav\nBeta.wav\nCharlie.wav\n') },
    { name: 'Other.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nCharlie.wav\nAlpha.wav\nBeta.wav\n') },
  ])
  const playlist = page.getByRole('button', { name: 'Mix.m3u8', exact: true })
  if (!await playlist.isVisible()) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click()
  await playlist.click()
  await expect(page.getByRole('heading', { name: 'Mix', exact: true })).toBeVisible()
  await expect(page.locator('.track-title strong')).toHaveText(['Alpha', 'Beta', 'Charlie'])
}

test('visible navigation labels stay quiet while icon hints have one tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await library(page)
  for (const name of ['All tracks', 'Albums', 'Active playlist', 'Mix.m3u8']) {
    const button = page.locator('.sidebar-expanded').getByRole('button', { name, exact: true })
    await expect(button).not.toHaveAttribute('title')
    await button.hover(); await page.waitForTimeout(650)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  }
  const storage = page.getByRole('button', { name: 'Remember libraries', exact: true })
  await storage.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Request persistent browser storage')
  await expect(page.getByRole('tooltip')).toHaveCount(1)
  await expect(storage).not.toHaveAttribute('title')
  await storage.click(); await expect(page.getByRole('tooltip')).toHaveCount(0)
  await trackRow(page, 'Beta').click(); await page.keyboard.press('Alt+ArrowUp')
  const draft = page.locator('.sidebar-expanded .playlist-row .draft-dot')
  await draft.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Unsaved draft')
  await expect(draft).not.toHaveAttribute('title')
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.locator('.app').evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))) })
  await page.locator('.sidebar-rail').getByRole('button', { name: 'All tracks', exact: true }).hover()
  await expect(page.getByRole('tooltip')).toHaveText('All tracks')
})

test('desktop workspace stays fixed while tracks scroll and filters use the available space', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const names = Array.from({ length: 40 }, (_, i) => `Track ${String(i + 1).padStart(2, '0')}`)
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    ...names.map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(taggedWav(.1, { title: name, artist: 'Test artist', album: 'Test album' })) })),
    { name: 'Mix.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from(`#EXTM3U\n${names.map(name => `${name}.wav`).join('\n')}\n`) },
  ])
  await page.getByRole('button', { name: 'Mix.m3u8', exact: true }).click()
  await expect(page.locator('.browse-count')).toHaveText('40 tracks')
  const scroll = page.locator('.track-scroll')
  const fixed = async () => {
    for (const selector of ['.main', '.workspace']) {
      expect(await page.locator(selector).evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
      expect(await page.locator(selector).evaluate(element => element.scrollTop)).toBe(0)
    }
  }
  const heroTop = (await page.locator('.collection-hero').boundingBox())!.y
  await scroll.hover(); await page.mouse.wheel(0, 1800)
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await fixed()
  expect((await page.locator('.collection-hero').boundingBox())!.y).toBe(heroTop)
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(page.locator('.track-title strong').filter({ hasText: 'Track 40' })).toBeVisible()
  await page.getByRole('button', { name: 'Track filters', exact: true }).click()
  await fixed()
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click()
  await fixed()
  await page.getByRole('button', { name: 'Close lyrics', exact: true }).click()
  await page.getByRole('button', { name: 'Track filters', exact: true }).click()
  await page.getByRole('button', { name: 'All tracks', exact: true }).click(); await fixed()
  await page.getByRole('button', { name: 'Albums', exact: true }).click(); await fixed()
  await expect(page.locator('.album-grid')).toBeVisible()
  await page.getByRole('button', { name: 'Active playlist', exact: true }).click()
  await page.setViewportSize({ width: 1024, height: 650 }); await fixed()
  await expect(scroll).toBeVisible()
  await page.setViewportSize({ width: 1024, height: 450 })
  await page.getByRole('button', { name: 'Export', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeInViewport()
})

test('clicking the sole selected row clears selection in playlists and All tracks without shifting rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await library(page)
  const a = trackRow(page, 'Alpha'), b = trackRow(page, 'Beta')
  for (const view of ['Active playlist', 'All tracks']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    const top = (await a.boundingBox())!.y
    await a.click(); await expect(a).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
    const alpha = await page.locator('.selection-toolbar.floating').evaluate(element => {
      const context = document.createElement('canvas').getContext('2d')!
      context.fillStyle = getComputedStyle(element).backgroundColor; context.fillRect(0, 0, 1, 1)
      return context.getImageData(0, 0, 1, 1).data[3]
    })
    expect(alpha).toBeGreaterThan(0); expect(alpha).toBeLessThan(255)
    if (view === 'Active playlist') await page.screenshot({ path: 'test-results/selection-toolbar-glass.png' })
    await a.click(); await expect(a).toHaveAttribute('aria-selected', 'false')
    await expect(a).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(a).toHaveCSS('box-shadow', 'none')
    await page.mouse.move(0, 0)
    await expect(a).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await a.hover(); await expect(a).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.selection-toolbar')).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: 'Title', exact: true })).toBeVisible()
    expect((await a.boundingBox())!.y).toBe(top)
    await a.focus(); await a.press('ControlOrMeta+Space'); await a.press('ArrowUp')
    await expect(a).toHaveAttribute('aria-selected', 'true')
    await b.click({ modifiers: ['ControlOrMeta'] }); await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
    await a.click(); await expect(a).toHaveAttribute('aria-selected', 'true')
    await expect(b).toHaveAttribute('aria-selected', 'false')
    await a.click(); await expect(page.locator('.track-row[aria-selected=true]')).toHaveCount(0)
  }
  await b.dblclick()
  await expect(page.locator('.now-playing strong')).toHaveText('Beta')
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
})

test('row selection supports modifiers, Ctrl/Cmd+Space and ranges without starting playback', async ({ page }) => {
  // Keep all fixture rows in view so ordinary scroll-to-click is distinct
  // from a selection toolbar changing the row layout.
  await page.setViewportSize({ width: 1440, height: 900 })
  await library(page)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  const a = trackRow(page, 'Alpha'), b = trackRow(page, 'Beta'), c = trackRow(page, 'Charlie')
  const rowTop = (await a.boundingBox())!.y
  await a.click(); await c.click({ modifiers: ['ControlOrMeta'] })
  expect((await a.boundingBox())!.y).toBe(rowTop)
  await expect(page.locator('.browse-count')).toHaveText('3 tracks')
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await c.focus(); await c.press('ControlOrMeta+Space'); await expect(c).toHaveAttribute('aria-selected', 'false')
  await a.click(); await c.click({ modifiers: ['Shift'] }); await expect(b).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('3 selected', { exact: true })).toBeVisible()
  await c.press('Escape'); await expect(page.locator('.track-row[aria-selected=true]')).toHaveCount(0)
  await a.focus(); await a.press('ControlOrMeta+Space'); await a.press('Shift+ArrowDown')
  await expect(b).toBeFocused(); await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0)
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await expect(a).toHaveAttribute('aria-selected', 'true')
  await expect(a).toHaveCSS('outline-style', 'solid')
})

test('menus let Tab continue normally and outside clicks keep dialog focus', async ({ page }) => {
  await library(page)
  const sort = page.getByRole('button', { name: 'Sort tracks', exact: true })
  await sort.click()
  await expect(page.getByRole('menuitemradio', { name: 'Playlist order', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: 'Title', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(sort).not.toBeFocused()
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
  await sort.click()
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a playlist', exact: true })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'New playlist', exact: true })).toBeFocused()
})

test('desktop playlist select supports typeahead, Escape and normal Tab inside a dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await library(page)
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a playlist' }), source = dialog.getByRole('combobox', { name: 'Playlist source' })
  await source.focus(); await source.press('o')
  await expect(page.getByRole('listbox', { name: 'Playlist source' })).toBeVisible()
  await expect(source).toHaveAttribute('aria-activedescendant', await page.getByRole('option', { name: 'Other.m3u8', exact: true }).getAttribute('id') ?? '')
  await source.press('Escape'); await expect(dialog).toBeVisible(); await expect(source).toBeFocused()
  await source.click(); await source.press('Tab')
  await expect(page.getByRole('listbox')).toHaveCount(0); await expect(source).not.toBeFocused()
  await source.click(); await page.getByRole('option', { name: 'Other.m3u8', exact: true }).click()
  await expect(source).toHaveAttribute('data-value', 'Other.m3u8')
  await expect(dialog.getByRole('textbox', { name: 'Playlist file' })).toHaveValue('Other.m3u8')
  await expect(dialog.getByLabel('Playlist order preview')).toContainText('Charlie.wav')
  await page.screenshot({ path: 'test-results/ui-overhaul-create.png' })
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Track filters', exact: true }).click()
  await selectValue(page.getByRole('combobox', { name: 'Artist', exact: true }), 'Other artist')
  await expect(page.locator('.browse-count')).toHaveText('1 matching tracks')
  await expect(page.locator('.track-title strong')).toHaveText(['Beta'])
  await expect(page.locator('.collection-meta')).toContainText('3 tracks')
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.locator('.browse-count')).toHaveText('3 tracks')
  await expect(page.locator('.track-title strong')).toHaveText(['Alpha', 'Beta', 'Charlie'])
})

test('track headings align with row content as workspace width changes', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 }); await library(page)
  await expect(page.locator('.selection-toolbar')).toHaveCount(0)
  await page.getByRole('button', { name: 'Play Alpha', exact: true }).click()
  for (const width of [1600, 1100, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect.poll(() => page.evaluate(() => {
      const header = [...document.querySelectorAll<HTMLElement>('.track-header > span')]
      const row = [...document.querySelectorAll<HTMLElement>('.track-row [role=gridcell]')].slice(0, 6)
      return header.every((cell, index) => {
        if (!cell.getClientRects().length) return true
        const h = cell.getBoundingClientRect(), r = row[index].getBoundingClientRect()
        return Math.abs(h.left - r.left) <= 1 && Math.abs(h.right - r.right) <= 1
      })
    })).toBe(true)
    await expect(page.locator('.browse-count')).toHaveText('3 tracks')
    if (width >= 800) {
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        const art = rect('.collection-hero > .artwork'), title = rect('.collection-heading'), actions = rect('.workspace-actions'), tabs = rect('.browse-tabs'), count = rect('.browse-count')
        return { titleAtTop: Math.abs(title.top - art.top) < 1, controlsBesideArt: actions.left > art.right && actions.top >= title.bottom, countBesideTabs: count.left > tabs.right && Math.abs(count.top + count.height / 2 - tabs.top - tabs.height / 2) < 1 }
      })
      expect(geometry).toEqual({ titleAtTop: true, controlsBesideArt: true, countBesideTabs: true })
    }
    const alpha = await page.locator('.track-header').evaluate(element => {
      const color = getComputedStyle(element).backgroundColor
      const probe = document.createElement('canvas').getContext('2d')!
      probe.fillStyle = color; probe.fillRect(0, 0, 1, 1)
      return probe.getImageData(0, 0, 1, 1).data[3]
    })
    expect(alpha).toBeGreaterThan(0); expect(alpha).toBeLessThan(255)
    if (width === 1600 || width === 390) await page.screenshot({ path: `test-results/ui-overhaul-tracks-${width}.png` })
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click()
  await expect(page.locator('.track-scroll')).toBeVisible()
  await expect.poll(() => page.locator('.track-scroll').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
})

test('mobile setup uses native selectors, fits narrow screens and keeps file choices disabled', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await library(page)
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  const dialog = page.getByRole('dialog'), source = dialog.getByRole('combobox', { name: 'Playlist source' })
  expect(await source.evaluate(element => element.tagName)).toBe('SELECT')
  await expect(dialog.getByRole('radio', { name: /Numbered filenames only/ })).toBeDisabled()
  await source.selectOption('Other.m3u8')
  await expect(dialog.getByLabel('Playlist order preview')).toContainText('Charlie.wav')
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
})

for (const width of [1440, 900, 390]) test(`compact player keeps playback and controls accessible at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await library(page)
  const footer = page.getByRole('contentinfo', { name: 'Music player' })
  await footer.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(footer.locator('.now-playing strong')).toHaveText('Alpha')
  const fullHeight = (await footer.boundingBox())!.height
  const mainHeight = (await page.locator('.main').boundingBox())!.height
  const scrollHeight = (await page.locator('.track-scroll').boundingBox())!.height
  await trackRow(page, 'Beta').click()
  await footer.getByRole('button', { name: 'Collapse player', exact: true }).click()
  await expect(footer.getByRole('button', { name: 'Restore player', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await footer.boundingBox())!.height).toBeCloseTo(fullHeight - 40, 0)
  expect((await page.locator('.main').boundingBox())!.height).toBeCloseTo(mainHeight + 40, 0)
  expect((await page.locator('.track-scroll').boundingBox())!.height).toBeCloseTo(scrollHeight + 40, 0)
  await expect(trackRow(page, 'Beta')).toHaveAttribute('aria-selected', 'true')
  await expect(footer.getByRole('slider', { name: 'Seek', exact: true })).toHaveCount(0)
  await expect(footer.locator('.now-playing .artwork')).toBeVisible()
  await footer.getByRole('button', { name: 'Pause', exact: true }).click()
  await footer.getByRole('button', { name: 'Next track', exact: true }).click()
  await expect(footer.locator('.now-playing strong')).toHaveText('Beta')
  await expect(footer.getByRole('button', { name: 'Lyrics', exact: true })).toBeVisible()
  await footer.getByRole('button', { name: width < 768 ? 'Expand player' : 'More player controls', exact: true }).click()
  const controls = page.getByRole('dialog', { name: width < 768 ? 'Now playing' : 'Player controls', exact: true })
  await expect(controls.getByRole('slider', { name: 'Seek', exact: true })).toBeVisible()
  await controls.getByRole('button', { name: 'Close dialog', exact: true }).click()
  if (width !== 900) await page.screenshot({ path: `test-results/compact-player-${width}.png` })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Restore player', exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Restore player', exact: true }).click()
  await expect(footer.getByRole('slider', { name: 'Seek', exact: true })).toBeVisible()
  expect((await footer.boundingBox())!.height).toBeCloseTo(fullHeight, 0)
})

test('Space controls playback from rows and buttons without changing selection or activating the button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await library(page)
  const footer = page.getByRole('contentinfo', { name: 'Music player' })
  const beta = trackRow(page, 'Beta')
  await beta.click(); await beta.press('Space')
  await expect(footer.locator('.now-playing strong')).toHaveText('Alpha')
  await expect(beta).toHaveAttribute('aria-selected', 'true')
  await expect(footer.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await beta.press('Space')
  await expect(footer.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  const shuffle = footer.getByRole('button', { name: 'Shuffle', exact: true })
  await shuffle.focus(); await page.keyboard.down('Space')
  await expect(footer.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.keyboard.down('Space'); await page.keyboard.up('Space')
  await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
  await expect(footer.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  const albums = page.getByRole('button', { name: 'Albums', exact: true })
  await albums.focus(); await page.keyboard.press('Space')
  await expect(page.getByRole('heading', { name: 'Mix', exact: true })).toBeVisible()
  await expect(footer.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await footer.getByRole('slider', { name: 'Seek', exact: true }).focus(); await page.keyboard.press('Space')
  await expect(footer.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await beta.focus(); await beta.press('ControlOrMeta+Space')
  await expect(beta).toHaveAttribute('aria-selected', 'false')
  await expect(footer.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Search all music', exact: true }).fill('Test')
  await page.keyboard.press('End'); await page.keyboard.press('Space'); await page.keyboard.type('artist')
  await expect(page.getByRole('combobox', { name: 'Search all music', exact: true })).toHaveValue('Test artist')
  await expect(footer.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a playlist', exact: true })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(dialog).toHaveCount(0)
  await expect(footer.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
})

test('a queued row-focus scroll keeps its menu open, while scrolling that moves the row dismisses it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await library(page)
  await trackRow(page, 'Alpha').click({ modifiers: ['ControlOrMeta'] })
  await trackRow(page, 'Charlie').click({ modifiers: ['ControlOrMeta'] })
  await trackRow(page, 'Alpha').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Track actions', exact: true })
  await expect(menu).toBeVisible()
  await page.locator('.track-scroll').dispatchEvent('scroll')
  await expect(menu).toBeVisible()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await page.locator('.track-scroll').evaluate(element => { element.scrollTop = 1000 })
  await expect.poll(() => page.locator('.track-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(menu).toHaveCount(0)
})
