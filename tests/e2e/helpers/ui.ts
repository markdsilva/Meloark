import { expect, type Locator, type Page } from '@playwright/test'

export async function selectValue(control: Locator, value: string) {
  if (await control.evaluate(element => element.tagName === 'SELECT')) { await control.selectOption(value); return }
  await control.click()
  const options = control.page().getByRole('listbox').getByRole('option')
  for (const option of await options.all()) {
    if (await option.getAttribute('data-value') === value) { await option.click(); await expect(control).toHaveAttribute('data-value', value); return }
  }
  throw new Error(`Select option not found: ${value}`)
}

export function trackRow(control: Page | Locator, title: string) {
  return control.getByRole('row').filter({ has: ('page' in control ? control.page() : control).locator('.track-title strong').filter({ hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
}
