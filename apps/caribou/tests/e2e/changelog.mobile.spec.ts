import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './_fixtures.js'

// Runs in the `mobile-webkit` project only. On a phone the Settings item,
// which carries the unread dot, is in the More menu, so the More trigger
// carries the dot too.

const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
const KEY = 'alice@example.social'
const rail = (page: Page) => page.locator('litro-outlet > :not([hidden]) caribou-nav-rail')
const more = (page: Page) => rail(page).locator('caribou-menu.more')

async function signedIn(page: Page, lastSeen: string) {
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('e2e.seeded')) return
    sessionStorage.setItem('e2e.seeded', '1')
    const account = { id: 'a1', username: 'alice', acct: 'alice' }
    localStorage.setItem('caribou.users', JSON.stringify([[data.key,
      { userKey: data.key, server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.key))
    localStorage.setItem(`caribou.prefs.${data.key}`, JSON.stringify({ lastSeenChangelogVersion: data.lastSeen }))
  }, { key: KEY, lastSeen })
  await page.route('https://example.social/**', (route) => route.fulfill({ json: [] }))
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test('the More trigger shows the dot without opening the menu, and /changelog clears it', async ({ page }) => {
  await signedIn(page, '0.0.1')
  await gotoSettled(page, '/about')
  const trigger = more(page).locator('.trigger')
  await expect(more(page).locator('.more-trigger caribou-changelog-dot:not([text]) .dot')).toBeVisible()
  await expect(trigger).toHaveAccessibleName(/^More ?, new version$/)

  // The dot is on the icon's corner, inside the 44px trigger.
  const box = (await trigger.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)

  await trigger.tap()
  await more(page).getByRole('link', { name: /^Settings ?, new version$/ }).tap()
  await page.locator('litro-outlet > page-settings caribou-settings-about')
    .getByRole('link', { name: /^Changelog ?, new version$/ }).tap()
  await page.locator('litro-outlet > page-changelog').waitFor()
  await expect.poll(() => page.evaluate((k) =>
    JSON.parse(localStorage.getItem(`caribou.prefs.${k}`) ?? '{}').lastSeenChangelogVersion, KEY)).toBe(PKG.version)
  await expect(more(page).locator('.more-trigger caribou-changelog-dot:not([text]) .dot')).toHaveCount(0)
  await expect(more(page).locator('.trigger')).toHaveAccessibleName('More')
})
