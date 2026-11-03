import { expect, test, type Page } from './_fixtures.js'

// Runs in the `mobile-webkit` project only (iPhone 15). The phone has no
// right rail: Search is in the More menu.

const rail = (page: Page) => page.locator('litro-outlet > :not([hidden]) caribou-nav-rail')
const search = (page: Page) => page.locator('litro-outlet > :not([hidden]) caribou-search')

async function signedIn(page: Page) {
  await page.addInitScript(() => {
    const key = 'alice@example.social'
    const account = { id: 'a1', username: 'alice', acct: 'alice' }
    localStorage.setItem('caribou.users', JSON.stringify([[key,
      { userKey: key, server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
  })
  await page.route('https://example.social/api/v1/accounts/relationships*', (route) => route.fulfill({ json: [] }))
  await page.route('https://example.social/api/v2/search*', (route) => route.fulfill({
    json: {
      accounts: [{
        id: 'b1', username: 'bob', acct: 'bob@other.social',
        display_name: 'Bob With A Rather Long Display Name That Must Not Widen The Page',
        avatar: '', avatar_static: '', url: 'https://other.social/@bob',
      }],
      statuses: [], hashtags: [],
    },
  }))
}

async function settled(page: Page) {
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test('Search is in More, and the page fits the phone', async ({ page }) => {
  await signedIn(page)
  await page.goto('/local')
  await settled(page)
  await rail(page).locator('caribou-menu.more .trigger').tap()
  await rail(page).locator('caribou-menu.more a.menu-item[href="/search"]').tap()
  await expect(page).toHaveURL(/\/search$/)
  await settled(page)
  const input = search(page).locator('input[name="q"]')
  await input.fill('bob')
  await expect(search(page).locator('.account .acct')).toHaveText('@bob@other.social')
  await expect(page).toHaveURL(/\/search\?q=bob$/)
  for (const name of ['People', 'Hashtags', 'Posts']) {
    await expect(search(page).locator('.tabs a', { hasText: name })).toBeVisible()
  }
  const box = await input.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
