import { expect, isGroupedProbe404, test, type Page } from './_fixtures.js'

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

function account(id: string, username: string) {
  return {
    id, username, acct: username, display_name: username,
    avatar: AVATAR, avatar_static: AVATAR,
    url: `https://${INSTANCE}/@${username}`, header: '', header_static: '', note: '',
    followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
    discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
  }
}
const ALICE = account('a1', 'alice')
const BOB = account('b1', 'bob')
const CAROL = account('c1', 'carol')

function makeStatus(id: string, over: Record<string, unknown> = {}) {
  return {
    id, uri: `https://${INSTANCE}/@bob/${id}`, url: `https://${INSTANCE}/@bob/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: BOB, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 1, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
    ...over,
  }
}

// What Mastodon answers a boost with: the reader's new wrapper status.
function wrapper(id: string, inner: Record<string, unknown>, by = ALICE) {
  return makeStatus(id, { account: by, content: '', reblog: inner, reblogs_count: 0 })
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const json = (body: unknown, status = 200) =>
  ({ status, contentType: 'application/json', body: JSON.stringify(body) })

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !isGroupedProbe404(m.text(), m.location().url)) errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

let home: unknown[] = []
const calls: string[] = []

test.beforeEach(async ({ page }) => {
  calls.length = 0
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: ALICE, createdAt: 1,
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
    return route.fulfill(json(home))
  })
  await page.route(/\/api\/v1\/statuses\/[^/]+\/(reblog|unreblog)$/, (route) => {
    const [, id, verb] = /statuses\/([^/]+)\/(\w+)$/.exec(new URL(route.request().url()).pathname)!
    calls.push(`${verb}:${id}`)
    const inner = makeStatus(id!, { reblogged: verb === 'reblog', reblogs_count: verb === 'reblog' ? 2 : 1 })
    return route.fulfill(json(verb === 'reblog' ? wrapper('w-new', inner) : inner))
  })
})

test('boost then undo a plain post on /home', async ({ page }) => {
  home = [makeStatus('p')]
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  const boost = page.getByRole('button', { name: 'Boost', exact: true })
  await expect(boost).toBeEnabled()
  await boost.click()
  const undo = page.getByRole('button', { name: 'Undo boost' })
  await expect(undo).toHaveAttribute('aria-pressed', 'true')
  await expect(undo).toHaveText('2')
  expect(calls).toEqual(['reblog:p'])
  await undo.click()
  await expect(boost).toHaveAttribute('aria-pressed', 'false')
  await expect(boost).toHaveText('1')
  expect(calls).toEqual(['reblog:p', 'unreblog:p'])
  expect(errors).toEqual([])
})

test('boost a post shown inside another account\'s boost', async ({ page }) => {
  home = [wrapper('w1', makeStatus('p'), CAROL)]
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  const boost = page.getByRole('button', { name: 'Boost', exact: true })
  await expect(boost).toBeEnabled()
  await boost.click()
  await expect(page.getByRole('button', { name: 'Undo boost' })).toHaveText('2')
  expect(calls).toEqual(['reblog:p'])
  expect(errors).toEqual([])
})

test('the b key boosts the focused post', async ({ page }) => {
  home = [makeStatus('p')]
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  await page.keyboard.press('j')
  await page.keyboard.press('b')
  await expect(page.getByRole('button', { name: 'Undo boost' })).toHaveText('2')
  expect(calls).toEqual(['reblog:p'])
  expect(errors).toEqual([])
})

async function boostAfter(page: Page, go: () => Promise<void>) {
  const errors = collectErrors(page)
  await go()
  const boost = page.getByRole('button', { name: 'Boost', exact: true }).first()
  await expect(boost).toBeEnabled()
  await boost.click()
  await expect(page.getByRole('button', { name: 'Undo boost' }).first()).toHaveText('2')
  expect(calls).toEqual(['reblog:p'])
  expect(errors).toEqual([])
}

test('boost on /notifications', async ({ page }) => {
  await page.route('**/api/v1/notifications*', (r) => r.fulfill(json([
    { id: 'n1', type: 'mention', created_at: '2024-01-01T00:00:00.000Z', account: BOB, status: makeStatus('p') },
  ])))
  await boostAfter(page, () => gotoSettled(page, '/notifications'))
})
