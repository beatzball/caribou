import { expect, type Page } from './_fixtures.js'
import { API, BOB, gotoSettled, json, signIn, status } from './_moderation.js'

// Two real routes, each tall enough for its own reading position. Use their
// real page elements and the production router, with only upstream data mocked.
export async function checkComposeHistory(page: Page) {
  await signIn(page)
  for (const endpoint of ['timelines/home', 'timelines/public']) {
    await page.route(`${API}/v1/${endpoint}*`, (route) => {
      const query = new URL(route.request().url()).searchParams
      return route.fulfill(json(query.has('max_id') || query.has('since_id')
        ? [] : Array.from({ length: 30 }, (_, i) => status(String(i + 1), BOB))))
    })
  }
  await page.route(`${API}/v2/instance`, (route) => route.fulfill(json({})))
  // Serve Local's page data so both timelines reach their full height before
  // router scroll restoration, without a real upstream request.
  await page.route((url) => url.pathname === '/local', (route) =>
    route.request().headers()['accept'] === 'application/json'
      ? route.fulfill(json({ kind: 'ok', nextCursor: null, shell: { instance: 'example.social' },
        statuses: Array.from({ length: 30 }, (_, i) => status(String(i + 1), BOB)) }))
      : route.continue())
  const shown = page.locator('litro-outlet > :not([hidden])')
  const scrollTo = async (y: number) => {
    // The router's listener runs before this one and records the position.
    await page.evaluate((top) => new Promise<void>((resolve) => {
      window.addEventListener('scroll', () => resolve(), { once: true })
      window.scrollTo(0, top)
    }), y)
    expect(await page.evaluate(() => window.scrollY)).toBe(y)
  }
  await gotoSettled(page, '/home')
  await expect(shown.locator('caribou-status-card')).toHaveCount(30)
  await scrollTo(400)
  // dispatchEvent avoids Playwright first scrolling the link into view.
  await shown.locator('caribou-nav-rail a[href="/local"]').first().dispatchEvent('click', { button: 0 })
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)
  await expect(shown.locator('caribou-status-card')).toHaveCount(30)
  await scrollTo(600)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('caribou:compose')))
  await expect(page.getByRole('dialog', { name: 'New post' })).toBeVisible()
  // Allow the browser's scroll event from applying the lock to reach the
  // router; a fixed body would overwrite this entry with zero.
  await page.waitForTimeout(200)
  await page.goBack()
  await expect(page.locator('litro-outlet > page-home:not([hidden])')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goForward()
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)
  await expect(shown.locator('caribou-status-card')).toHaveCount(30)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)
}
