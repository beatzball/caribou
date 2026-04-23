import { expect, test } from '@playwright/test'

test('signin-done shim parses fragment → writes localStorage → navigates /home', async ({ page }) => {
  // Intercept /home so the test doesn't depend on Phase F's page being fully wired
  // against a live Mastodon backend; we only care that the shim reached /home.
  await page.route('**/home', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><p id="home-stub">home reached</p></body></html>',
    }),
  )

  await page.goto(
    '/signin/done#token=TOK&server=fosstodon.org&userKey=beatzball%40fosstodon.org&vapidKey=VK',
  )
  await page.waitForSelector('#home-stub')

  const ls = await page.evaluate(() => ({
    users: localStorage.getItem('caribou.users'),
    active: localStorage.getItem('caribou.activeUserKey'),
  }))
  expect(ls.active).toBe('"beatzball@fosstodon.org"')
  expect(ls.users).toContain('"token":"TOK"')
  expect(ls.users).toContain('"server":"fosstodon.org"')
})

test('signin-done shows fallback when fragment is missing', async ({ page }) => {
  await page.goto('/signin/done')
  await expect(page.getByText(/something went wrong/i)).toBeVisible()
})

test('signin-done shows fallback when userKey is malformed', async ({ page }) => {
  await page.goto('/signin/done#token=TOK&server=fosstodon.org&userKey=bogus&vapidKey=VK')
  await expect(page.getByText(/something went wrong/i)).toBeVisible()
})
