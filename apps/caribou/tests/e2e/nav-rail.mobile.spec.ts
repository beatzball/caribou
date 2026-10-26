import { expect, test, type Page } from '@playwright/test'

// Runs in the `mobile-webkit` project only (iPhone 15: touch, 393px wide), so
// the nav rail is the fixed bottom bar and every press is a tap.

const rail = (page: Page) => page.locator('litro-outlet > :not([hidden]) caribou-nav-rail')
const item = (page: Page, href: string) => rail(page).locator(`a[href="${href}"]`)

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test('a tapped item looks pending at once while the next page loads', async ({ page }) => {
  // Hold the next page's data the way a slow phone network does. Until it
  // arrives the router keeps the current page, and its rail, on screen.
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/local', async (route) => {
    if (route.request().headers()['accept'] === 'application/json') await held
    await route.continue()
  })
  await gotoSettled(page, '/public')
  await expect(item(page, '/public')).toHaveAttribute('aria-current', 'page')

  await item(page, '/local').tap()

  // The tap answers at once, but `aria-current` still names the shown page.
  await expect(item(page, '/local')).toHaveAttribute('data-pending', '', { timeout: 300 })
  await expect(item(page, '/local')).not.toHaveAttribute('aria-current', 'page')
  await expect(item(page, '/public')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('litro-outlet > page-public:not([hidden])')).toHaveCount(1)

  release()
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(item(page, '/local')).toHaveAttribute('aria-current', 'page')
  await expect(item(page, '/local')).not.toHaveAttribute('data-pending')
})

test('bottom bar items are at least 44px square', async ({ page }) => {
  await gotoSettled(page, '/public')
  for (const href of ['/home', '/local', '/public', '/@me']) {
    const box = await item(page, href).boundingBox()
    expect(box, href).not.toBeNull()
    expect(box!.width, href).toBeGreaterThanOrEqual(44)
    expect(box!.height, href).toBeGreaterThanOrEqual(44)
  }
})

test('fast taps across the bar still land on the last one', async ({ page }) => {
  await gotoSettled(page, '/public')
  for (const href of ['/local', '/public', '/local', '/public', '/local']) {
    await item(page, href).tap()
  }
  await expect.poll(() => new URL(page.url()).pathname).toBe('/local')
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(item(page, '/local')).toHaveAttribute('aria-current', 'page')
})

test('the page asks for viewport-fit=cover so safe-area insets apply', async ({ page }) => {
  await gotoSettled(page, '/public')
  const metas = await page.locator('meta[name="viewport"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('content') ?? ''))
  // The last viewport meta is the one the browser uses.
  expect(metas.at(-1)).toContain('viewport-fit=cover')
})
