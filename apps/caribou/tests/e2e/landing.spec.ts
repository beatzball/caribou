import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// A full page load mounts the page twice; the router swaps the two and then
// marks the outlet. Before that, fill() and click() can land on different
// mounts, so every test that interacts waits for it.
async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

test('landing page renders picker', async ({ page }) => {
  await gotoSettled(page, '/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Caribou')
  await expect(page.getByLabel(/your mastodon instance/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

test('landing page shows error banner on ?error=denied and clears the param', async ({ page }) => {
  // Both mounts show the banner until the router's swap, so wait for one.
  await gotoSettled(page, '/?error=denied')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
  await expect.poll(() => page.url()).not.toContain('error=')
  // The banner outlives the URL clean-up.
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
})

test('landing page shows the session-expired banner from sessionStorage, once', async ({ page }) => {
  await gotoSettled(page, '/')
  await expect(page.getByRole('alert')).toHaveCount(0)

  await page.evaluate(() => sessionStorage.setItem('caribou.error', 'unauthorized'))
  await gotoSettled(page, '/')
  await expect(page.getByRole('alert')).toContainText(/your session expired/i)
  expect(await page.evaluate(() => sessionStorage.getItem('caribou.error'))).toBeNull()

  await gotoSettled(page, '/')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('submitting the picker POSTs /api/signin/start and follows the redirect', async ({ page }) => {
  let posted: unknown
  await page.route('**/api/signin/start', (route) => {
    posted = route.request().postDataJSON()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authorizeUrl: 'https://example.test/oauth/authorize?mock' }),
    })
  })
  // Intercept the eventual navigation to the fake instance to avoid leaving the site.
  await page.route('https://example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>authorize page</p>' }),
  )
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill('example.social')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/example\.test/)
  expect(page.url()).toContain('https://example.test/oauth/authorize?mock')
  expect(posted).toEqual({ server: 'example.social' })
})

test('the picker shows "Connecting…" and disables the button while it waits', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/api/signin/start', async (route) => {
    await held
    await route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
  })
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill('example.social')
  await page.getByRole('button', { name: /sign in/i }).click()

  const button = page.locator('caribou-instance-picker button[type="submit"]')
  await expect(button).toHaveText(/connecting…/i)
  await expect(button).toBeDisabled()

  release()
  await expect(button).toHaveText(/sign in/i)
  await expect(button).toBeEnabled()
})

test('the picker shows an error and stays on the page when the instance is rejected', async ({ page }) => {
  await page.route('**/api/signin/start', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: '{}' }),
  )
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill('nope.example')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Could not reach that instance. Check the spelling and try again.',
  )
  expect(new URL(page.url()).pathname).toBe('/')
})

test('the picker shows a network error when the request fails', async ({ page }) => {
  await page.route('**/api/signin/start', (route) => route.abort('failed'))
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill('example.social')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('alert')).toHaveText('Network error — try again.')
})

test('landing page has no a11y violations', async ({ page }) => {
  await gotoSettled(page, '/')
  const results = await new AxeBuilder({ page })
    .disableRules(['landmark-one-main', 'page-has-heading-one'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('health endpoint returns ok with build metadata', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
  expect(typeof body.commit).toBe('string')
  expect(body.commit.length).toBeGreaterThan(0)
  expect(typeof body.version).toBe('string')
  expect(body.version.length).toBeGreaterThan(0)
})
