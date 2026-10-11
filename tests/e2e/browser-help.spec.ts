import { test, expect } from '@playwright/test'

test('browser tip is optional, limited to a first non-Chromium visit, and remembered', async ({ page }, info) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Choose a music folder', exact: true })).toBeEnabled()
  const tip = page.getByRole('region', { name: 'Browser tip', exact: true })
  if (info.project.name === 'chromium') {
    await expect(tip).toHaveCount(0)
    return
  }
  await expect(tip).toContainText('Desktop Chrome and Edge support direct folder access')
  await expect(tip).toContainText('listen, edit and export here')
  await page.screenshot({ path: `test-results/browser-tip-${info.project.name}.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(tip.getByRole('button', { name: 'Dismiss browser tip', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: `test-results/browser-tip-mobile-${info.project.name}.png` })
  await tip.getByRole('button', { name: 'Dismiss browser tip', exact: true }).click()
  await expect(tip).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: /A home for your.*local music/ })).toBeVisible()
  await expect(tip).toHaveCount(0)
})

test('Chromium without direct access is not told to switch to Chrome', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36' })
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
  })
  await page.goto('/')
  await expect(page.getByText('Portable mode available', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Browser tip', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Browser support', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Save playlists to a folder', { exact: true }).locator('..').locator('..')).toContainText('Unavailable')
  await expect(page.getByRole('dialog').getByText('Playlist export', { exact: true }).locator('..').locator('..')).toContainText('Available')
  await expect(page.getByText('Save directly with desktop Chrome or Edge', { exact: true })).toHaveCount(0)
})

test('capabilities starts concise, preserves diagnostics and fits mobile', async ({ page }, info) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Browser support', exact: true }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Help & browser support', exact: true })
  await expect(dialog.getByRole('heading', { name: 'Available', exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Requires permission or verification' })).toBeVisible()
  await expect(dialog.getByText('Playlist file deletion', { exact: true })).toBeVisible()
  await expect(dialog.getByText('No music uploads', { exact: true })).toBeHidden()
  await page.screenshot({ path: `test-results/capabilities-${info.project.name}.png` })
  const summary = dialog.locator('summary')
  await summary.focus(); await page.keyboard.press('Enter')
  await expect(dialog.getByText('Playlist file deletion', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Draft and metadata storage', { exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText('No music uploads', { exact: true })).toBeHidden()
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(dialog.getByText('Save playlists to a folder', { exact: true })).toBeVisible()
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    if (width === 390) await page.screenshot({ path: `test-results/capabilities-mobile-${info.project.name}.png` })
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Browser support', exact: true })).toBeFocused()
})

test('browser tip remains dismissible if presentation storage is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Firefox/130.0' })
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Storage.prototype.getItem = () => { throw new DOMException('Denied', 'SecurityError') }
    Storage.prototype.setItem = () => { throw new DOMException('Denied', 'SecurityError') }
  })
  await page.goto('/')
  const tip = page.getByRole('region', { name: 'Browser tip', exact: true })
  await expect(tip).toBeVisible()
  await tip.getByRole('button', { name: 'Browser options', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Help & browser support', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  await expect(tip).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Choose a music folder', exact: true })).toBeEnabled()
})
