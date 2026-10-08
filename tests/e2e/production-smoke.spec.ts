import { test, expect } from '@playwright/test'
import { wavSample } from '../fixtures/audio'

test('the production bundle loads local samples, plays, reorders, exports and opens sync choices', async ({ page }) => {
  test.skip(process.env.MELOARK_TEST_BUILD !== '1', 'Production asset check is run separately after build.')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByLabel('Select library files', { exact: true }).setInputFiles([
    ...['First', 'Second', 'Third'].map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(wavSample(30)) })),
    { name: 'Sample.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nFirst.wav\nSecond.wav\nThird.wav\n') },
  ])
  await expect(page.locator('.track-title strong')).toHaveText(['First', 'Second', 'Third'])
  await page.getByRole('button', { name: 'Play playlist', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('slider', { name: 'Seek', exact: true }).fill('3')
  await expect(page.locator('.seek')).toContainText('0:03')
  await page.getByRole('checkbox', { name: 'Select First', exact: true }).check()
  await page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Play First', exact: true }) }).press('Alt+ArrowDown')
  await expect(page.locator('.track-title strong')).toHaveText(['Second', 'First', 'Third'])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.track-title strong')).toHaveText(['First', 'Second', 'Third'])
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('Sample.m3u8')
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  await expect(page.getByRole('radio', { name: /Numbered filenames only/ })).toBeDisabled()
  await expect(page.getByRole('radio', { name: /Numbered filenames \+ M3U8/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.screenshot({ path: 'test-results/production-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/production-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  expect(errors).toEqual([])
})
