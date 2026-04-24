import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('landing page renders picker', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Caribou')
  await expect(page.getByLabel(/your mastodon instance/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

test('landing page shows error banner on ?error=denied and clears the param', async ({ page }) => {
  await page.goto('/?error=denied')
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
  await expect.poll(() => page.url()).not.toContain('error=')
})

test('submitting the picker POSTs /api/signin/start and follows the redirect', async ({ page }) => {
  await page.route('**/api/signin/start', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authorizeUrl: 'https://example.test/oauth/authorize?mock' }),
    }),
  )
  // Intercept the eventual navigation to the fake instance to avoid leaving the site.
  await page.route('https://example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>authorize page</p>' }),
  )
  await page.goto('/')
  await page.getByLabel(/your mastodon instance/i).fill('fosstodon.org')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/example\.test/)
  expect(page.url()).toContain('https://example.test/oauth/authorize?mock')
})

test('landing page has no a11y violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page })
    .disableRules(['landmark-one-main', 'page-has-heading-one'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
})
