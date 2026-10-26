import { expect, test, type Page } from './_fixtures.js'

const INSTANCE = 'example.social'
const USER_KEY = `alice@${INSTANCE}`
const AVATAR = `https://${INSTANCE}/a.png`

const BOB = {
  id: 'b1', username: 'bob', acct: 'bob', display_name: 'Bob Example',
  avatar: AVATAR, avatar_static: AVATAR,
  url: `https://${INSTANCE}/@bob`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function makeStatus(id: string, content: string) {
  return {
    id, uri: `https://${INSTANCE}/@bob/${id}`, url: `https://${INSTANCE}/@bob/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: BOB, content,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

function makeNotification(id: string, type: string, content?: string) {
  return {
    id, type, created_at: '2024-01-01T00:00:00.000Z', account: BOB, group_key: `ungrouped-${id}`,
    ...(content ? { status: makeStatus(`s${id}`, content) } : {}),
  }
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

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

async function signIn(page: Page, prefs?: Record<string, unknown>) {
  await page.addInitScript(({ key, prefs }) => {
    if (sessionStorage.getItem('seeded') === '1') return
    const account = { id: 'a1', username: 'alice', acct: 'alice' }
    localStorage.setItem('caribou.users', JSON.stringify([[key,
      { userKey: key, server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
    if (prefs) localStorage.setItem(`caribou.prefs.${key}`, JSON.stringify(prefs))
    sessionStorage.setItem('seeded', '1')
  }, { key: USER_KEY, prefs })
}

test.beforeEach(async ({ page }) => {
  await page.route('**/a.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.route('**/api/v1/timelines/home*', (route) => route.fulfill({ json: [] }))
})

const ALL = [
  makeNotification('5', 'mention', '<p>hi @alice</p>'),
  makeNotification('4', 'favourite', '<p>my post</p>'),
  makeNotification('3', 'reblog', '<p>my post</p>'),
  makeNotification('2', 'follow'),
  makeNotification('1', 'brand_new_type'),
]

test('/notifications signed out shows the placeholder, from the server on', async ({ page, request }) => {
  const body = await (await request.get('/notifications')).text()
  expect(body).toContain('requires a Mastodon access token')
  expect(body).not.toContain('<caribou-notifications')

  const errors = collectErrors(page)
  await gotoSettled(page, '/notifications')
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page.locator('caribou-notifications')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('/notifications lists each type, and Mentions asks for types[]=mention', async ({ page }) => {
  const asked: string[] = []
  await page.route('**/api/v1/notifications*', (route) => {
    const u = new URL(route.request().url())
    // Older pages, polls, and the badge's own fetch (limit=40) are not the list.
    if (u.searchParams.get('max_id') || u.searchParams.get('min_id')) return route.fulfill({ json: [] })
    if (u.searchParams.get('limit')) return route.fulfill({ json: [] })
    const types = u.searchParams.getAll('types[]')
    asked.push(types.join(',') || 'all')
    return route.fulfill({ json: types.includes('mention') ? ALL.slice(0, 1) : ALL })
  })
  await signIn(page)
  const errors = collectErrors(page)
  await gotoSettled(page, '/notifications')

  const list = page.locator('caribou-notifications')
  await expect(list.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
  await expect(list.locator('li')).toHaveCount(5)
  await expect(list.getByText('hi @alice')).toBeVisible()
  await expect(list.locator('li.n-favourite')).toContainText('Bob Example favourited your post')
  await expect(list.locator('li.n-reblog')).toContainText('Bob Example boosted your post')
  await expect(list.locator('li.n-follow')).toContainText('Bob Example followed you')
  await expect(list.locator('li').nth(4)).toContainText('Bob Example sent you a notification')
  await expect(list.locator('li.n-follow').getByRole('link', { name: 'Bob Example' }))
    .toHaveAttribute('href', '/@bob@example.social')

  const all = list.getByRole('button', { name: 'All', exact: true })
  const mentions = list.getByRole('button', { name: 'Mentions', exact: true })
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await mentions.click()
  await expect(mentions).toHaveAttribute('aria-pressed', 'true')
  await expect(list.locator('li')).toHaveCount(1)
  expect(asked.at(-1)).toBe('mention')
  expect(errors).toEqual([])
})

test('the nav rail shows the unread count, and opening the page clears it', async ({ page }) => {
  await page.route('**/api/v1/notifications*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('max_id') || u.searchParams.get('min_id')) return route.fulfill({ json: [] })
    const since = u.searchParams.get('since_id')
    if (since === '3') return route.fulfill({ json: ALL.slice(0, 2) })
    if (since) return route.fulfill({ json: [] })
    return route.fulfill({ json: ALL })
  })
  await signIn(page, { lastSeenNotificationId: '3' })
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')

  const rail = page.locator('page-home caribou-nav-rail')
  // The visible label stays first in the name; the count is read after it.
  // The label is a flex item, so some browsers put a space before the comma.
  await expect(rail.getByRole('link', { name: /^Notifications ?, 2 unread$/ })).toBeVisible()

  await rail.getByRole('link', { name: /^Notifications/ }).click()
  await expect(page).toHaveURL(/\/notifications$/)
  const list = page.locator('page-notifications caribou-notifications')
  await expect(list.locator('li')).toHaveCount(5)
  const nextRail = page.locator('page-notifications caribou-nav-rail')
  await expect(nextRail.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(nextRail.locator('.badge')).toHaveCount(0)
  const prefs = await page.evaluate((key) => localStorage.getItem(`caribou.prefs.${key}`), USER_KEY)
  expect(JSON.parse(prefs!)).toEqual({ lastSeenNotificationId: '5' })
  expect(errors).toEqual([])
})

test('/notifications does not poll in a hidden tab, and polls when it is shown again', async ({ page }) => {
  let newer = false
  let polls = 0
  await page.route('**/api/v1/notifications*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('max_id')) return route.fulfill({ json: [] })
    if (u.searchParams.get('min_id') === '5') {
      polls++
      return route.fulfill({ json: newer ? [makeNotification('6', 'favourite', '<p>later post</p>')] : [] })
    }
    if (u.searchParams.get('limit')) return route.fulfill({ json: [] })
    return route.fulfill({ json: ALL })
  })
  await page.addInitScript(() => {
    // Lets the test hide and show the tab. Playwright's own tab is always visible.
    let state: DocumentVisibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' })
    ;(window as unknown as { setVisibility: (v: DocumentVisibilityState) => void }).setVisibility = (v) => {
      state = v
      document.dispatchEvent(new Event('visibilitychange'))
    }
    // Poll every 200ms, so a missing hidden-tab stop shows within the test.
    void customElements.whenDefined('caribou-notifications').then((C) => {
      (C as unknown as { pollMs: number }).pollMs = 200
    })
  })
  await signIn(page)
  await gotoSettled(page, '/notifications')
  const list = page.locator('caribou-notifications')
  await expect(list.locator('li')).toHaveCount(5)

  // Visible: the short timer polls.
  await expect.poll(() => polls).toBeGreaterThanOrEqual(2)

  await page.evaluate(() => (window as unknown as { setVisibility: (v: string) => void }).setVisibility('hidden'))
  newer = true
  // Let a poll that was already on its way land first.
  await page.waitForTimeout(300)
  const before = polls
  // Hidden: five timer periods pass with no poll.
  await page.waitForTimeout(1000)
  expect(polls).toBe(before)
  await expect(list.locator('li')).toHaveCount(5)

  await page.evaluate(() => (window as unknown as { setVisibility: (v: string) => void }).setVisibility('visible'))
  await expect(list.locator('li')).toHaveCount(6)
  await expect(list.locator('li').first()).toContainText('later post')
  const prefs = await page.evaluate((key) => localStorage.getItem(`caribou.prefs.${key}`), USER_KEY)
  expect(JSON.parse(prefs!)).toEqual({ lastSeenNotificationId: '6' })
})
