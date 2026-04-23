import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('landing page renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Caribou')
})

test('landing page has no a11y violations', async ({ page }) => {
  await page.goto('/')
  // landmark-one-main and page-has-heading-one are best-practice rules that
  // axe cannot evaluate through Shadow DOM (Elena/LitElement uses shadow roots).
  // The <main> and <h1> are present in SSR output and in the shadow tree —
  // disabling these two rules here rather than suppressing all best-practice checks.
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
