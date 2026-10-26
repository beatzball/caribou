import { expect, test, type Page } from './_fixtures.js'

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

const SAMPLE_ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: AVATAR, avatar_static: AVATAR,
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

const STATUS = {
  id: 'a', uri: `https://${INSTANCE}/@alice/a`, url: `https://${INSTANCE}/@alice/a`,
  created_at: '2024-01-01T00:00:00.000Z', account: SAMPLE_ACCOUNT, content: '<p>post a</p>',
  visibility: 'public', sensitive: false, spoiler_text: '',
  media_attachments: [], mentions: [], tags: [], emojis: [],
  reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body: unknown) =>
  ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test.beforeEach(async ({ page }) => {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: SAMPLE_ACCOUNT, createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
  await page.route('**/a.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('since_id') || u.searchParams.get('max_id')) return route.fulfill(json([]))
    return route.fulfill(json([STATUS]))
  })
})

const timestamp = (page: Page) =>
  page.locator('page-home caribou-status-card litro-link.permalink time')

test('clicking a post time opens its thread without a full page load', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await gotoSettled(page, '/home')
  await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true })

  await timestamp(page).click()
  await expect(page).toHaveURL(/\/@alice\/a$/)
  await expect(page.locator('page-handle-statusid')).toHaveCount(1)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  expect(errors).toEqual([])
})

// A modifier click is the browser's: a new tab or window. The link must not
// cancel it. The window listener runs last, so it sees what the link did, and
// then cancels the click itself so the test opens no tab.
//
// Read this test with the one above. If `<litro-link>` were not defined at
// all, nothing would cancel the click and this test would still pass; the
// test above is the one that fails then.
test('a modifier click on a post time is left to the browser', async ({ page }) => {
  await gotoSettled(page, '/home')
  await page.evaluate(() => {
    window.addEventListener('click', (e) => {
      ;(window as unknown as { __prevented: boolean }).__prevented = e.defaultPrevented
      e.preventDefault()
    })
  })

  await timestamp(page).click({ modifiers: ['ControlOrMeta'] })
  expect(await page.evaluate(() => (window as unknown as { __prevented?: boolean }).__prevented)).toBe(false)
  await expect(page).toHaveURL(/\/home$/)
})
