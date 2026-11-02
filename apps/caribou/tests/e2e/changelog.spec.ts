import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './_fixtures.js'

// `/changelog` and its unread dot. The dot needs a stored account, whose
// prefs hold `lastSeenChangelogVersion`.

const INSTANCE = 'example.social'
const USER_KEY = `alice@${INSTANCE}`
const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: '', avatar_static: '', url: `https://${INSTANCE}/@alice`, header: '', header_static: '',
  note: '', followers_count: 0, following_count: 0, statuses_count: 0, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  return errors
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

// Seeds once: a reload keeps what the page wrote to the prefs.
async function signIn(page: Page, lastSeen: string | null) {
  await page.route(`https://${INSTANCE}/api/v1/accounts/verify_credentials`, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(ACCOUNT),
  }))
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('e2e.seeded')) return
    sessionStorage.setItem('e2e.seeded', '1')
    const session = { userKey: data.key, server: data.server, token: 'TOKEN', vapidKey: '', createdAt: 1 }
    localStorage.setItem('caribou.users', JSON.stringify([[data.key, session]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.key))
    if (data.lastSeen) {
      localStorage.setItem(`caribou.prefs.${data.key}`, JSON.stringify({ lastSeenChangelogVersion: data.lastSeen }))
    }
  }, { key: USER_KEY, server: INSTANCE, lastSeen })
}

const lastSeen = (page: Page) => page.evaluate((key) =>
  (JSON.parse(localStorage.getItem(`caribou.prefs.${key}`) ?? '{}') as Record<string, unknown>)
    .lastSeenChangelogVersion, USER_KEY)

// The dot is on the Settings nav item; Settings links to the changelog.
const settingsLink = (page: Page, tag: string) =>
  page.locator(`${tag} caribou-nav-rail`).getByRole('link', { name: /^Settings/ })

test('/changelog shows every version, newest first and open, with no hydration error', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoSettled(page, '/changelog')
  const root = page.locator('page-changelog')
  await expect(root.getByRole('heading', { level: 1, name: 'Changelog' })).toBeVisible()
  await expect(root.getByText(`You are using version ${PKG.version}.`)).toBeVisible()
  const sections = root.locator('section')
  await expect(sections.first()).toHaveAttribute('id', `v${PKG.version.replace(/\./g, '-')}`)
  await expect(sections.first().locator('details')).toHaveAttribute('open', '')
  await expect(sections.nth(1).locator('details')).not.toHaveAttribute('open', '')
  // Raw changesets boilerplate is not shown.
  await expect(root.getByText('Thanks', { exact: false })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a link to an older version opens that version', async ({ page }) => {
  await gotoSettled(page, '/changelog#v0-2-0')
  const section = page.locator('page-changelog section#v0-2-0')
  await expect(section.locator('details')).toHaveAttribute('open', '')
  await expect(section.getByRole('heading', { level: 2 })).toBeInViewport()
})

test('a hash change on the page opens that version and scrolls to it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await gotoSettled(page, '/changelog')
  const section = page.locator('page-changelog section#v0-2-0')
  await expect(section.getByRole('heading', { level: 2 })).not.toBeInViewport()
  await page.evaluate(() => { location.hash = '#v0-2-0' })
  await expect(section.locator('details')).toHaveAttribute('open', '')
  await expect(section.getByRole('heading', { level: 2 })).toBeInViewport()
})

test('a full load of /changelog with an old marker clears the dot', async ({ page }) => {
  await signIn(page, '0.0.1')
  await gotoSettled(page, '/changelog')
  await expect.poll(() => lastSeen(page)).toBe(PKG.version)
  await expect(settingsLink(page, 'page-changelog')).toHaveAccessibleName('Settings')
  await expect(settingsLink(page, 'page-changelog').locator('caribou-changelog-dot:not([text]) .dot')).toHaveCount(0)
})

test('the disclosure glyph is not read out', async ({ page }) => {
  await gotoSettled(page, '/changelog')
  const summary = page.locator('page-changelog summary').first()
  expect(await summary.ariaSnapshot()).not.toMatch(/[▸▾]/)
})

test('the dot shows when a newer version shipped, and opening /changelog clears it', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page, '0.0.1')
  await gotoSettled(page, '/about')
  const link = settingsLink(page, 'page-about')
  const dot = link.locator('caribou-changelog-dot:not([text])')
  await expect(dot).toHaveAttribute('unread', '')
  await expect(dot.locator('.dot')).toBeVisible()
  await expect(link).toHaveAccessibleName(/^Settings ?, new version$/)

  await link.click()
  const about = page.locator('page-settings caribou-settings-about')
  const toChangelog = about.getByRole('link', { name: /^Changelog ?, new version$/ })
  await expect(about.locator('caribou-changelog-dot:not([text]) .dot')).toBeVisible()
  await toChangelog.click()
  await page.locator('page-changelog').waitFor()
  await expect(settingsLink(page, 'page-changelog').locator('caribou-changelog-dot:not([text]) .dot')).toHaveCount(0)
  expect(await lastSeen(page)).toBe(PKG.version)

  await gotoSettled(page, '/about')
  await expect(settingsLink(page, 'page-about')).toHaveAccessibleName('Settings')
  await expect(settingsLink(page, 'page-about').locator('caribou-changelog-dot:not([text]) .dot')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a new account takes the running version as seen, with no dot', async ({ page }) => {
  await signIn(page, null)
  await gotoSettled(page, '/about')
  await expect.poll(() => lastSeen(page)).toBe(PKG.version)
  await expect(settingsLink(page, 'page-about').locator('caribou-changelog-dot:not([text]) .dot')).toHaveCount(0)
})

test('the dot moves nothing when it shows', async ({ page }) => {
  await signIn(page, '0.0.1')
  await gotoSettled(page, '/about')
  const link = settingsLink(page, 'page-about')
  await expect(link.locator('caribou-changelog-dot:not([text])')).toHaveAttribute('unread', '')
  const withDot = await link.boundingBox()
  const label = await link.locator('.label').boundingBox()
  await link.locator('caribou-changelog-dot:not([text])').evaluate((el) => { (el as HTMLElement).style.display = 'none' })
  expect(await link.boundingBox()).toEqual(withDot)
  expect(await link.locator('.label').boundingBox()).toEqual(label)
})
