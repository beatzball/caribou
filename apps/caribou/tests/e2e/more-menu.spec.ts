import { expect, test, type Page } from '@playwright/test'

// The More menu at phone width, driven by keyboard and mouse. Touch is in
// more-menu.mobile.spec.ts.

const rail = (page: Page) => page.locator('page-local caribou-nav-rail')
const trigger = (page: Page) => rail(page).locator('caribou-menu .trigger')
const panel = (page: Page) => rail(page).locator('caribou-menu .panel')

async function openLocal(page: Page, width = 360) {
  await page.setViewportSize({ width, height: 700 })
  await page.goto('/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  // Show the signed-in controls without a session.
  await rail(page).evaluate((el) => { el.removeAttribute('signed-out'); el.setAttribute('can-compose', '') })
}

test('Enter opens More and focuses the first item; Tab walks the items; Escape closes and returns focus', async ({ page, browserName }) => {
  // Safari's Tab skips links unless its setting says otherwise; Option+Tab
  // is the key its users press to reach them.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  await openLocal(page)
  await trigger(page).focus()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toBeVisible()
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true')
  const publicLink = rail(page).getByRole('link', { name: 'Public', exact: true })
  await expect(publicLink).toBeFocused()

  await page.keyboard.press(tab)
  await expect(rail(page).getByRole('link', { name: 'Bookmarks', exact: true })).toBeFocused()
  await page.keyboard.press(tab)
  await expect(rail(page).getByRole('button', { name: 'Sign out', exact: true })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger(page)).toBeFocused()
})

test('Space opens it too', async ({ page }) => {
  await openLocal(page)
  await trigger(page).focus()
  await page.keyboard.press(' ')
  await expect(panel(page)).toBeVisible()
})

test('a click outside closes More', async ({ page }) => {
  await openLocal(page)
  await trigger(page).click()
  await expect(panel(page)).toBeVisible()
  await page.mouse.click(20, 80)
  await expect(panel(page)).toBeHidden()
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
})

test('a second click on More closes it', async ({ page }) => {
  await openLocal(page)
  await trigger(page).click()
  await expect(panel(page)).toBeVisible()
  await trigger(page).click()
  await expect(panel(page)).toBeHidden()
})

test('from 768px up every item is in the rail and More is gone', async ({ page }) => {
  await openLocal(page, 900)
  await expect(trigger(page)).toBeHidden()
  await expect(rail(page).locator('nav > a[href="/public"]')).toBeVisible()
  await expect(rail(page).locator('nav > caribou-signout-form .signout-btn')).toBeVisible()
  const tree = await rail(page).ariaSnapshot()
  expect(tree).not.toContain('More')
  expect(tree.match(/Sign out/g)).toHaveLength(1)
  expect(tree.match(/link "Public"/g)).toHaveLength(1)
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('More opens from the server HTML, and Sign out is a native form', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 })
    await page.goto('/local')
    const nav = page.locator('caribou-nav-rail')
    const more = nav.getByRole('button', { name: 'More', exact: true })
    await expect(more).toBeVisible()
    await more.click()
    await expect(nav.locator('caribou-menu .panel')).toBeVisible()
    await expect(nav.locator('caribou-menu a.menu-item[href="/public"]')).toBeVisible()
    await expect(nav.locator('caribou-menu a.menu-item[href="/bookmarks"]')).toBeVisible()
    await expect(nav.locator('caribou-menu form[action="/api/signout"][method="post"] button[type="submit"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(nav.locator('caribou-menu .panel')).toBeHidden()
  })
})
