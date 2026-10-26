import { expect, test, type Page, type Route } from './_fixtures.js'

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

const SAMPLE_ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: AVATAR, avatar_static: AVATAR,
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function makeStatus(id: string, content = `<p>post ${id}</p>`, bookmarked = true) {
  return {
    id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: SAMPLE_ACCOUNT, content,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked, language: 'en',
  }
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// The browser reads a cross-origin Link header only when the server exposes
// it, as Mastodon does.
function fulfillPage(route: Route, body: unknown[], nextMaxId?: string) {
  const headers: Record<string, string> = {
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'Link',
  }
  if (nextMaxId) {
    headers.link = `<https://${INSTANCE}/api/v1/bookmarks?max_id=${nextMaxId}>; rel="next", `
      + `<https://${INSTANCE}/api/v1/bookmarks?min_id=999>; rel="prev"`
  }
  return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

async function signIn(page: Page) {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: SAMPLE_ACCOUNT, createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/a.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
})

test('/bookmarks server-renders the placeholder', async ({ request }) => {
  // Bookmarks are private; the token lives only in the browser.
  const body = await (await request.get('/bookmarks')).text()
  expect(body).toContain('/bookmarks shows the posts you bookmarked')
  expect(body).not.toContain('<caribou-timeline')
})

test('/bookmarks signed out shows the auth-required placeholder', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoSettled(page, '/bookmarks')
  await expect(page.getByText(/requires a Mastodon access token/i)).toBeVisible()
  await expect(page.locator('caribou-timeline')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('/bookmarks pages with the Link header cursor, not the last status id', async ({ page }) => {
  await signIn(page)
  const asked: Array<string | null> = []
  await page.route(`https://${INSTANCE}/api/v1/bookmarks*`, (route) => {
    const maxId = new URL(route.request().url()).searchParams.get('max_id')
    asked.push(maxId)
    // Bookmark ids (the cursor) are unrelated to status ids.
    if (maxId === null) return fulfillPage(route, [makeStatus('s90', '<p>newest bookmark</p>')], '5000')
    if (maxId === '5000') return fulfillPage(route, [makeStatus('s20', '<p>older bookmark</p>')], '4000')
    if (maxId === '4000') return fulfillPage(route, [makeStatus('s70', '<p>oldest bookmark</p>')])
    return fulfillPage(route, [makeStatus('wrong', '<p>paged by status id</p>')])
  })
  const errors = collectErrors(page)
  await gotoSettled(page, '/bookmarks')
  await expect(page.locator('caribou-timeline[kind="bookmarks"]')).toHaveCount(1)
  await expect(page.locator('caribou-status-card'))
    .toHaveText([/newest bookmark/, /older bookmark/, /oldest bookmark/])
  // The last page had no next link: the list ends without another request.
  await expect(page.locator('a[data-sentinel]')).toHaveCount(0)
  expect(asked.filter((m) => m !== null)).toEqual(['5000', '4000'])
  expect(errors).toEqual([])
})

test('/bookmarks with no bookmarks says so', async ({ page }) => {
  await signIn(page)
  await page.route(`https://${INSTANCE}/api/v1/bookmarks*`, (route) => fulfillPage(route, []))
  await gotoSettled(page, '/bookmarks')
  await expect(page.getByText('No bookmarks yet.')).toBeVisible()
  await expect(page.locator('caribou-status-card')).toHaveCount(0)
})

test('removing a bookmark keeps the card, with its button off', async ({ page }) => {
  await signIn(page)
  await page.route(`https://${INSTANCE}/api/v1/bookmarks*`, (route) =>
    fulfillPage(route, [makeStatus('s1', '<p>keep me</p>')]))
  let unbookmarked = 0
  await page.route(`https://${INSTANCE}/api/v1/statuses/s1/unbookmark`, (route) => {
    unbookmarked += 1
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(makeStatus('s1', '<p>keep me</p>', false)),
    })
  })
  await gotoSettled(page, '/bookmarks')
  const button = page.locator('caribou-status-card caribou-icon-button.bookmark')
  await expect(button).toHaveAttribute('pressed', 'true')
  await button.click()
  await expect(button).toHaveAttribute('pressed', 'false')
  expect(unbookmarked).toBe(1)
  await expect(page.locator('caribou-status-card')).toHaveText([/keep me/])
})

test('the nav rail links to /bookmarks', async ({ page }) => {
  await gotoSettled(page, '/bookmarks')
  const link = page.locator('page-bookmarks caribou-nav-rail').getByRole('link', { name: 'Bookmarks' })
  await expect(link).toHaveAttribute('href', '/bookmarks')
  await expect(link).toHaveAttribute('aria-current', 'page')
})
