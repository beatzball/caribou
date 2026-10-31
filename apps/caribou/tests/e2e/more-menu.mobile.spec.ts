import { expect, test, type Page } from './_fixtures.js'

// Runs in the `mobile-webkit` project only (iPhone 15: touch). The phone bar
// holds Home, Local, Notifications, New post, Profile and More; the rest are
// in More.

const rail = (page: Page) => page.locator('litro-outlet > :not([hidden]) caribou-nav-rail')
const trigger = (page: Page) => rail(page).locator('caribou-menu.more .trigger')
const panel = (page: Page) => rail(page).locator('caribou-menu.more .panel')

async function signedIn(page: Page) {
  await page.addInitScript(() => {
    const key = 'alice@example.social'
    const account = { id: 'a1', username: 'alice', acct: 'alice' }
    localStorage.setItem('caribou.users', JSON.stringify([[key,
      { userKey: key, server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
  })
  await page.route('https://example.social/**', (route) => route.fulfill({ json: [] }))
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

for (const width of [320, 360, 393]) {
  test(`every bar item is inside the viewport and 44px at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await signedIn(page)
    await gotoSettled(page, '/local')
    const nav = rail(page).locator('nav')
    await expect(rail(page).locator('.compose-btn')).toBeVisible()
    expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth), 'nav does not overflow').toBe(true)

    const shown = {
      '/home': rail(page).locator('nav > a[href="/home"]'),
      '/local': rail(page).locator('nav > a[href="/local"]'),
      '/notifications': rail(page).locator('nav > a[href="/notifications"]'),
      'New post': rail(page).locator('.compose-btn'),
      '/@me': rail(page).locator('nav > a[href="/@me"]'),
      'More': trigger(page),
    }
    for (const [name, loc] of Object.entries(shown)) {
      await expect(loc, name).toBeVisible()
      const box = (await loc.boundingBox())!
      expect(box.width, name).toBeGreaterThanOrEqual(44)
      expect(box.height, name).toBeGreaterThanOrEqual(44)
      expect(box.x, `${name} left`).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, `${name} right`).toBeLessThanOrEqual(width)
    }
    // Left to right in the owner's order, which is also the DOM order.
    const xs = await Promise.all(Object.values(shown).map(async (l) => (await l.boundingBox())!.x))
    expect(xs).toEqual([...xs].sort((a, b) => a - b))

    // Moved into More: not shown, and so not in the accessibility tree.
    await expect(rail(page).locator('nav > a[href="/public"]')).toBeHidden()
    await expect(rail(page).locator('nav > a[href="/bookmarks"]')).toBeHidden()
    await expect(rail(page).locator('caribou-menu.account')).toBeHidden()
    // getByRole still finds a slotted item in the closed panel (its own
    // style is not display: none); the accessibility snapshot does not.
    const tree = await rail(page).ariaSnapshot()
    expect(tree).toContain('button "More"')
    expect(tree).not.toContain('Public')
    expect(tree).not.toContain('Bookmarks')
    expect(tree).not.toContain('Sign out')
    expect(tree).not.toContain('Accounts')
  })
}

test('a tap opens More above the bar, inside the viewport, with 44px items', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await signedIn(page)
  await gotoSettled(page, '/local')
  await expect(panel(page)).toBeHidden()

  await trigger(page).tap()
  await expect(panel(page)).toBeVisible()
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true')
  const p = (await panel(page).boundingBox())!
  const bar = (await rail(page).locator('nav').boundingBox())!
  expect(p.y + p.height, 'panel bottom above the bar').toBeLessThanOrEqual(bar.y)
  expect(p.x).toBeGreaterThanOrEqual(0)
  expect(p.x + p.width).toBeLessThanOrEqual(320)

  for (const name of ['Public', 'Bookmarks']) {
    const link = rail(page).getByRole('link', { name, exact: true })
    await expect(link).toBeVisible()
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  const more = rail(page).locator('caribou-menu.more')
  for (const item of [
    more.getByRole('link', { name: 'Signed in as alice @alice@example.social', exact: true }),
    more.getByRole('link', { name: 'Add account', exact: true }),
    more.getByRole('button', { name: 'Sign out of @alice@example.social', exact: true }),
  ]) {
    await expect(item).toBeVisible()
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
})

test('More shows the current mark while a page from its menu is shown', async ({ page }) => {
  await signedIn(page)
  await gotoSettled(page, '/local')
  const more = rail(page).locator('caribou-menu.more')
  await expect(more).not.toHaveAttribute('data-current')
  const plain = await trigger(page).evaluate((el) => getComputedStyle(el).backgroundColor)
  await trigger(page).tap()
  await rail(page).getByRole('link', { name: 'Public', exact: true }).tap()
  await expect(page.locator('litro-outlet > page-public:not([hidden])')).toHaveCount(1)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(more).toHaveAttribute('data-current', '')
  expect(await trigger(page).evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(plain)
})

test('a tap outside closes More', async ({ page }) => {
  await signedIn(page)
  await gotoSettled(page, '/local')
  await trigger(page).tap()
  await expect(panel(page)).toBeVisible()
  await page.touchscreen.tap(20, 80)
  await expect(panel(page)).toBeHidden()
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
})

test('a link in More goes to its page and the menu closes', async ({ page }) => {
  await signedIn(page)
  await gotoSettled(page, '/local')
  await trigger(page).tap()
  await rail(page).getByRole('link', { name: 'Public', exact: true }).tap()
  await expect(page.locator('litro-outlet > page-public:not([hidden])')).toHaveCount(1)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(panel(page)).toBeHidden()
})
