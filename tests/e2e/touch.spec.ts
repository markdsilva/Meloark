import { test, expect } from '@playwright/test'
import { wavSample } from '../fixtures/audio'
test('touch selection and handle dragging move a group without requiring hover', async ({ browser }, info) => {
  test.skip(info.project.name !== 'chromium', 'Native touch-event injection is provided by Chromium CDP; real mobile devices remain manual checks.')
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  try {
    const page = await context.newPage(); await page.goto(info.project.use.baseURL!)
    await page.getByLabel('Select library files', { exact: true }).setInputFiles([
      ...['A', 'B', 'C'].map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(wavSample()) })),
      { name: 'Touch.m3u8', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\nA.wav\nB.wav\nC.wav\n') },
    ])
    await page.getByRole('button', { name: 'Select tracks', exact: true }).tap()
    await page.getByRole('checkbox', { name: 'Select A', exact: true }).locator('..').tap()
    await page.getByRole('checkbox', { name: 'Select B', exact: true }).locator('..').tap()
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
    await page.locator('.main').evaluate(element => { element.scrollTop = element.scrollHeight })
    const target = page.getByRole('button', { name: 'Reorder C', exact: true })
    const from = await page.getByRole('button', { name: 'Reorder A', exact: true }).boundingBox(), to = await target.boundingBox()
    expect(from!.width).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x: from!.x + 20, y: from!.y + 20 })).toBe('Reorder A')
    const cdp = await context.newCDPSession(page)
    const send = (type: 'touchStart' | 'touchEnd' | 'touchMove', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 2, radiusY: 2 }] })
    await send('touchStart', from!.x + 20, from!.y + 20)
    await expect(page.getByText('Moving 2 tracks', { exact: true })).toBeVisible()
    for (let step = 1; step <= 12; step++) await send('touchMove', from!.x + 20, from!.y + 20 + (to!.y - from!.y) * step / 12)
    await expect(page.getByRole('row').filter({ has: target })).toHaveClass(/drop-target/)
    await send('touchEnd', 0, 0)
    await expect(page.locator('.track-title strong')).toHaveText(['C', 'A', 'B'])
  } finally { await context.close() }
})
