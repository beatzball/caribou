import { expect, test } from './_fixtures.js'

// `<caribou-tabs>`: link tabs that the server renders. Without JavaScript
// the row is still a named navigation of real links, and the current one
// carries `aria-current="page"`.
test.describe('search tabs without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('are links in a navigation named "Result type"', async ({ page }) => {
    await page.goto('/search?q=cats&type=hashtags')
    await expect(page.getByRole('navigation', { name: 'Result type' })).toBeVisible()
    // The links are slotted: in the accessibility tree they sit inside the
    // shadow <nav>, but in the DOM they are the host's children.
    const nav = page.locator('caribou-search caribou-tabs')
    await expect(nav.getByRole('link')).toHaveText(['People', 'Hashtags', 'Posts'])
    await expect(nav.getByRole('link', { name: 'Hashtags' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: 'Posts' })).toHaveAttribute('href', '/search?q=cats&type=statuses')
    // A plain link: following it is a full page load to the other tab.
    await nav.getByRole('link', { name: 'Posts' }).click()
    await expect(page).toHaveURL(/\/search\?q=cats&type=statuses$/)
    await expect(page.locator('caribou-search caribou-tabs')
      .getByRole('link', { name: 'Posts' })).toHaveAttribute('aria-current', 'page')
  })
})

test('a tab takes keyboard focus and shows a ring', async ({ page }) => {
  await page.goto('/search?q=cats')
  await page.waitForSelector('litro-outlet[data-litro-settled]', { state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  const nav = page.locator('litro-outlet > :not([hidden]) caribou-search caribou-tabs')
  await nav.getByRole('link', { name: 'People' }).focus()
  await page.keyboard.press('Tab')
  const hashtags = nav.getByRole('link', { name: 'Hashtags' })
  await expect(hashtags).toBeFocused()
  expect(await hashtags.evaluate((a) => getComputedStyle(a).outlineStyle)).toBe('solid')
})
