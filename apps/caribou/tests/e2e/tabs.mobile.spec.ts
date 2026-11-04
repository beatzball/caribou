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

// A screen too narrow for the three search tabs: the row scrolls, the page
// does not, and a shadow at the edge says more tabs are there.
test('on a narrow screen the tab row scrolls, not the page, and shows a cue', async ({ page }) => {
  await page.setViewportSize({ width: 200, height: 700 })
  await page.goto('/search?q=cats')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  const tabs = page.locator('litro-outlet > :not([hidden]) caribou-search caribou-tabs')
  const row = await tabs.evaluate((el) => {
    const nav = el.shadowRoot!.querySelector('nav')!
    const s = getComputedStyle(nav)
    return {
      scroll: nav.scrollWidth, client: nav.clientWidth,
      image: s.backgroundImage, attachment: s.backgroundAttachment,
    }
  })
  expect(row.scroll).toBeGreaterThan(row.client)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // The cue: covers that scroll with the tabs over shadows that stay put.
  expect(row.image.match(/gradient/g)?.length).toBe(4)
  expect(row.attachment).toBe('local, local, scroll, scroll')
  for (const name of ['People', 'Hashtags', 'Posts']) {
    const box = await tabs.getByRole('link', { name }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
})
