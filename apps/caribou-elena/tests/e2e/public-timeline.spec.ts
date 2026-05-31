import { expect, test } from '@playwright/test'

// Hits the real fosstodon.org via the server's SSR pageData fetch (no
// browser-level interception is possible because the fetch is in the
// nitro process). Skip in CI to avoid coupling builds to upstream
// uptime; run locally to verify the cookie-only public-timeline path.
test.skip(!!process.env.CI, 'Hits real upstream; skip in CI')

async function withInstanceCookie(context: import('@playwright/test').BrowserContext) {
  await context.addCookies([
    {
      name: 'caribou.instance',
      value: 'fosstodon.org',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])
}

test('/local renders the cookie-instance public timeline without an active session', async ({ page, context }) => {
  await withInstanceCookie(context)
  await page.goto('/local')
  await page.waitForSelector('caribou-status-card', { timeout: 5000 })
  expect(await page.locator('caribou-status-card').count()).toBeGreaterThan(0)
  await expect(page.locator('text=No posts yet')).toHaveCount(0)
})

test('/public renders the cookie-instance public timeline without an active session', async ({ page, context }) => {
  await withInstanceCookie(context)
  await page.goto('/public')
  await page.waitForSelector('caribou-status-card', { timeout: 5000 })
  expect(await page.locator('caribou-status-card').count()).toBeGreaterThan(0)
})
