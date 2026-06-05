import { expect, test, type BrowserContext } from '@playwright/test'

// Hits real fosstodon.org via the server's SSR pageData fetch. Skip in CI
// to avoid coupling builds to upstream uptime; run locally to verify the
// no-JS path renders cards and pagination from cookie alone.
test.skip(!!process.env.CI, 'Hits real upstream; skip in CI')

test.use({ javaScriptEnabled: false })

async function withInstanceCookie(context: BrowserContext) {
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

test('/local renders status cards with JS disabled', async ({ page, context }) => {
  await withInstanceCookie(context)
  await page.goto('/local')
  // Wait for the SSR'd DOM to settle (no JS = no hydration; the markup is final).
  await page.waitForSelector('caribou-status-card', { timeout: 5000 })
  const count = await page.locator('caribou-status-card').count()
  expect(count).toBeGreaterThan(0)
  await expect(page.locator('text=No posts yet')).toHaveCount(0)
})

test('/local Older posts anchor links to ?max_id=… without JS', async ({ page, context }) => {
  await withInstanceCookie(context)
  await page.goto('/local')
  const anchor = page.locator('a[rel="next"][data-sentinel]')
  await expect(anchor).toBeVisible()
  const href = await anchor.getAttribute('href')
  // SSR emits a relative `?max_id=…` (no window to read pathname from);
  // the browser resolves it against the current /local URL on click.
  expect(href).toMatch(/^(\/local)?\?max_id=/)
})
