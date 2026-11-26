import { expect, test, type Page } from './_fixtures.js'
import {
  PAGES, expectNavItemsFit, expectNoSidewaysScroll, gotoSettled, openPage, signIn, storeTextSize,
} from './_text-size.js'
import { livePage } from './_server-page.js'

// Runs in the `mobile-webkit` project only. The largest text size on the
// narrowest phone we support (320px wide, issue 309): no page scrolls
// sideways, and the bottom bar's items still fit.

const barHeight = (page: Page) => livePage(page).locator('caribou-nav-rail').evaluate((host) =>
  host.shadowRoot!.querySelector('nav')!.getBoundingClientRect().height)

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
})

test('the sign-in page fits at the largest step', async ({ page }) => {
  await storeTextSize(page, 'xl')
  await gotoSettled(page, '/')
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'xl')
  await expect(page.locator('caribou-instance-picker')).toBeVisible()
  await expectNoSidewaysScroll(page, '/')
})

test('every page fits at the largest step', async ({ page }) => {
  await storeTextSize(page, 'xl')
  await signIn(page)
  for (const { path, ready } of PAGES) {
    await openPage(page, path, ready)
    await expect(page.locator('html')).toHaveAttribute('data-text-size', 'xl')
    await expectNoSidewaysScroll(page, path)
    await expectNavItemsFit(page)
  }
})

// `scroll-padding-bottom` in `server/lib/base-head.ts` counts on a 61px bar.
test('the bottom bar keeps its height at the largest step', async ({ page }) => {
  await signIn(page)
  await openPage(page, '/home', 'caribou-status-card')
  const atDefault = await barHeight(page)
  expect(atDefault).toBe(61)
  await page.evaluate(() => { localStorage.setItem('caribou.textSize', 'xl') })
  await openPage(page, '/home', 'caribou-status-card')
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'xl')
  expect(await barHeight(page)).toBe(atDefault)
})

test('the More menu and the compose dialog fit at the largest step', async ({ page }) => {
  await storeTextSize(page, 'xl')
  await signIn(page)
  await openPage(page, '/home', 'caribou-status-card')
  const rail = livePage(page).locator('caribou-nav-rail')

  await rail.locator('caribou-menu.more .trigger').tap()
  const settings = rail.locator('caribou-menu.more a.menu-item[href="/settings"]')
  await expect(settings).toBeVisible()
  const box = (await settings.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(320)
  await expectNoSidewaysScroll(page, 'More menu')
  await page.keyboard.press('Escape')

  await rail.locator('.compose-btn').tap()
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await expect(dialog).toBeVisible()
  for (const name of ['Cancel', 'Post']) {
    const b = (await dialog.getByRole('button', { name, exact: true }).boundingBox())!
    expect(b.x, name).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width, name).toBeLessThanOrEqual(320)
  }
  const d = (await dialog.boundingBox())!
  expect(d.x).toBeGreaterThanOrEqual(0)
  expect(d.x + d.width).toBeLessThanOrEqual(320)
  await expectNoSidewaysScroll(page, 'compose dialog')
})
