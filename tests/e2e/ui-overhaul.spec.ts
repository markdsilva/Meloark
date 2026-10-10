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

test('row selection supports modifiers, Space and ranges without starting playback', async ({ page }) => {
  await library(page)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  const a = trackRow(page, 'Alpha'), b = trackRow(page, 'Beta'), c = trackRow(page, 'Charlie')
  const rowTop = (await a.boundingBox())!.y
  await a.click(); await c.click({ modifiers: ['ControlOrMeta'] })
  expect((await a.boundingBox())!.y).toBe(rowTop)
  await expect(page.locator('.browse-count')).toHaveText('3 tracks')
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await c.focus(); await c.press('Space'); await expect(c).toHaveAttribute('aria-selected', 'false')
  await a.click(); await c.click({ modifiers: ['Shift'] }); await expect(b).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('3 selected', { exact: true })).toBeVisible()
  await c.press('Escape'); await expect(page.locator('.track-row[aria-selected=true]')).toHaveCount(0)
  await a.focus(); await a.press('Space'); await a.press('Shift+ArrowDown')
  await expect(b).toBeFocused(); await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0)
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await expect(a).toHaveAttribute('aria-selected', 'true')
  await expect(a).toHaveCSS('outline-style', 'solid')
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
