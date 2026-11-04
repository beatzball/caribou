import { expect, test } from './_fixtures.js'

// Runs in the `mobile-webkit` project only (iPhone 15).
test('the profile tabs fit the phone and are 44px tall', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'alice@example.social'
    const account = { id: 'a1', username: 'alice', acct: 'alice' }
    localStorage.setItem('caribou.users', JSON.stringify([[key,
      { userKey: key, server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
  })
  const ACCOUNT = {
    id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice', avatar: '', avatar_static: '',
    url: 'https://example.social/@alice', header: '', header_static: '', note: '', followers_count: 0,
    following_count: 0, statuses_count: 0, locked: false, bot: false, created_at: '2024-01-01T00:00:00.000Z',
    fields: [], emojis: [],
  }
  await page.route('**/api/v1/accounts/lookup*', (route) => route.fulfill({ json: ACCOUNT }))
  await page.route('**/api/v1/accounts/a1/statuses*', (route) => route.fulfill({ json: [] }))
  await page.goto('/@me?tab=media')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(page.getByRole('navigation', { name: 'Profile' })).toBeVisible()
  const nav = page.locator('litro-outlet > :not([hidden]) caribou-profile-tabs caribou-tabs')
  await expect(nav.getByRole('link', { name: 'media' })).toHaveAttribute('aria-current', 'page')
  for (const name of ['posts', 'replies', 'media']) {
    const box = await nav.getByRole('link', { name }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
