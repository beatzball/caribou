import { test, expect } from '@playwright/test'

test('SSR renders without JavaScript (DSD in source)', async ({ request }) => {
  const response = await request.get('/')
  const body = await response.text()
  expect(body).toContain('shadowrootmode')
  expect(body).toContain('<caribou-landing')
  expect(body).toContain('Your Mastodon instance')
})

// The landing page has no page data, so the check runs against a page that does.
test('__litro_data__ is injected into HTML for a page with page data', async ({ request }) => {
  const response = await request.get('/about')
  const body = await response.text()
  expect(body).toContain('__litro_data__')
})

test('page-index is visible after hydration', async ({ page }) => {
  await page.goto('/')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('page-index')).toHaveCount(1)
  await expect(page.locator('page-index')).toBeVisible()
})
