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
  // Signed in, so New post and Sign out are in the bar too. The page is
  // server-rendered; answer any call to the instance with an empty list.
  await page.addInitScript(() => {
    const key = 'alice@example.social'
    const account = { id: 'a1', username: 'alice', acct: 'alice' }
    localStorage.setItem('caribou.users', JSON.stringify([[key,
      { userKey: key, server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
  })
  await page.route('https://example.social/**', (route) => route.fulfill({ json: [] }))
  await gotoSettled(page, '/public')
  const items = {
    '/home': item(page, '/home'), '/local': item(page, '/local'),
    '/public': item(page, '/public'), '/@me': item(page, '/@me'),
    '/bookmarks': item(page, '/bookmarks'),
    'New post': rail(page).locator('.compose-btn'),
    'Sign out': rail(page).locator('.signout-btn'),
  }
  for (const [name, loc] of Object.entries(items)) {
    await expect(loc, name).toBeVisible()
    const box = await loc.boundingBox()
    expect(box, name).not.toBeNull()
    expect(box!.width, name).toBeGreaterThanOrEqual(44)
    expect(box!.height, name).toBeGreaterThanOrEqual(44)
  }
})

// Narrow phones (320px, and 360px — a common Android width) must show every
// bar item; the bar is fixed and clips what does not fit.
// fixme: with Bookmarks the signed-in bar has 7 items and needs 372px. The
// owner decides the mobile bar layout once Notifications adds an 8th item.
for (const width of [320, 360]) {
  test.fixme(`every bar item is inside the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await page.addInitScript(() => {
      const key = 'alice@example.social'
      const account = { id: 'a1', username: 'alice', acct: 'alice' }
      localStorage.setItem('caribou.users', JSON.stringify([[key,
        { userKey: key, server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }]]))
      localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
    })
    await page.route('https://example.social/**', (route) => route.fulfill({ json: [] }))
    await gotoSettled(page, '/public')
    const nav = rail(page).locator('nav')
    await expect(rail(page).locator('.compose-btn')).toBeVisible()
    const fits = await nav.evaluate((el) => el.scrollWidth <= el.clientWidth)
    expect(fits, 'nav scrollWidth <= clientWidth').toBe(true)
    const items = nav.locator(':scope > a, .compose-btn, .signout-btn')
    for (let i = 0; i < await items.count(); i++) {
      const box = await items.nth(i).boundingBox()
      expect(box, `item ${i}`).not.toBeNull()
      expect(box!.x, `item ${i} left`).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, `item ${i} right`).toBeLessThanOrEqual(width)
    }
  })
}

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

test('a toast sits above the bottom bar, not over it', async ({ page }) => {
  await gotoSettled(page, '/public')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('caribou:toast',
    { detail: { kind: 'info', message: 'Hello' } })))
  const toast = page.locator('caribou-toaster .toast').first()
  await expect(toast).toBeVisible()
  const t = (await toast.boundingBox())!
  const bar = (await rail(page).locator('nav').boundingBox())!
  expect(t.y + t.height).toBeLessThanOrEqual(bar.y)
})
