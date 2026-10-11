import { test, expect } from '@playwright/test'

test('welcome fits a large desktop without an unnecessary scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1738, height: 946 })
  await page.goto('/')
  await expect(page.locator('.startup-status')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  for (const width of [1738, 1920]) {
    await page.setViewportSize({ width, height: 946 })
    for (const selector of ['.main', '.welcome']) {
      expect(await page.locator(selector).evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
    }
    await expect(page.getByRole('button', { name: 'Browser support', exact: true })).toBeInViewport()
    // The example card's footer must also fit inside its border.
    const preview = await page.locator('.welcome-preview').boundingBox()
    const bottom = await page.locator('.preview-bottom').boundingBox()
    expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(preview!.y + preview!.height)
  }
})

test('welcome uses a slim scrollbar when needed and keeps all actions reachable', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.startup-status')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 650], [1024, 450], [390, 844], [320, 700]]) {
    await page.setViewportSize({ width, height })
    const scroller = page.locator(width >= 768 && height >= 650 ? '.welcome' : '.main')
    await expect(scroller).toHaveCSS('scrollbar-width', 'thin')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    const support = page.getByRole('button', { name: 'Browser support', exact: true })
    await support.scrollIntoViewIfNeeded()
    await expect(support).toBeInViewport()
    const button = await support.boundingBox(), player = await page.getByRole('contentinfo').boundingBox()
    expect(button!.y + button!.height).toBeLessThanOrEqual(player!.y)
    await support.click()
    await expect(page.getByRole('dialog', { name: 'Help & browser support', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    const guide = page.getByRole('button', { name: 'Read quick start', exact: true })
    await guide.scrollIntoViewIfNeeded()
    await expect(guide).toBeInViewport()
    await page.getByRole('button', { name: 'Choose a music folder', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Choose a music folder', exact: true })).toBeInViewport()
  }
})
