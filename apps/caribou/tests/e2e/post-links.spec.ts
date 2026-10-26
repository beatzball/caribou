import { expect, test, type Page } from './_fixtures.js'

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

const account = (username: string, host = INSTANCE) => ({
  id: `id-${username}`, username, acct: host === INSTANCE ? username : `${username}@${host}`,
  display_name: `${username[0]!.toUpperCase()}${username.slice(1)} Example`,
  avatar: AVATAR, avatar_static: AVATAR,
  url: `https://${host}/@${username}`, header: '', header_static: '', note: `<p>bio of ${username}</p>`,
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
})

const ALICE = account('alice')
const BOB = account('bob', 'other.example')
const CAROL = account('carol')

const mention = (a: ReturnType<typeof account>) =>
  `<span class="h-card"><a href="${a.url}" class="u-url mention" target="_blank">@<span>${a.username}</span></a></span>`

const POST = {
  id: 's1', uri: `https://${INSTANCE}/@alice/s1`, url: `https://${INSTANCE}/@alice/s1`,
  created_at: '2024-01-01T00:00:00.000Z', account: ALICE,
  content: `<p>hi ${mention(BOB)} and ${mention(CAROL)} <a href="https://${INSTANCE}/tags/AI" class="mention hashtag" rel="tag">#<span>AI</span></a></p>`,
  visibility: 'public', sensitive: false, spoiler_text: '',
  media_attachments: [], emojis: [],
  mentions: [BOB, CAROL].map((a) => ({ id: a.id, username: a.username, acct: a.acct, url: a.url })),
  tags: [{ name: 'AI', url: `https://${INSTANCE}/tags/AI` }],
  reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, { userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '', account: ALICE, createdAt: 1 })
  await page.route('**/a.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.route('**/api/v1/timelines/home*', (route) =>
    route.fulfill(json(new URL(route.request().url()).searchParams.get('max_id') ? [] : [POST])))
  await page.route('**/api/v1/accounts/lookup*', (route) => {
    const acct = new URL(route.request().url()).searchParams.get('acct')
    const found = { 'bob@other.example': BOB, [`carol@${INSTANCE}`]: CAROL }[acct ?? '']
    return route.fulfill(found ? json(found) : { status: 404, body: '{}' })
  })
  await page.route('**/api/v1/accounts/*/statuses*', (route) => route.fulfill(json([])))
  // The server fetches a profile in the nitro process, where `page.route`
  // cannot reach. A client-side navigation asks for the page data from the
  // browser with `Accept: application/json`, so serve that here.
  for (const [a, handle] of [[BOB, 'bob@other.example'], [CAROL, `carol@${INSTANCE}`]] as const) {
    await page.route((url) => url.pathname === `/@${handle}`, (route) => {
      if (!/application\/json/.test(route.request().headers()['accept'] ?? '')) return route.continue()
      return route.fulfill(json({
        kind: 'ok', account: a, statuses: [], nextMaxId: null, tab: 'posts',
        shell: { instance: INSTANCE }, handle,
      }))
    })
  }
  await page.route('**/api/v1/accounts/relationships*', (route) => route.fulfill(json([])))
})

for (const [who, path] of [[BOB, '/@bob@other.example'], [CAROL, '/@carol@example.social']] as const) {
  test(`a mention of ${who.acct} opens Caribou's profile page without a page load`, async ({ page }) => {
    await gotoSettled(page, '/home')
    await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true })
    await page.locator('caribou-status-card .status-content a.mention:not(.hashtag)', { hasText: who.username }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(path)
    await expect(page.locator('caribou-profile-header .handle', { hasText: `@${who.username}` })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
    expect(page.context().pages()).toHaveLength(1)
  })
}

test('a hashtag keeps its instance href', async ({ page }) => {
  await gotoSettled(page, '/home')
  const tag = page.locator('caribou-status-card .status-content a.hashtag')
  await expect(tag).toHaveAttribute('href', `https://${INSTANCE}/tags/AI`)
  // Stop the real navigation; the card must not have routed it either.
  await page.route(`https://${INSTANCE}/tags/AI`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'instance tag page' }))
  await tag.click()
  await expect(page).toHaveURL(`https://${INSTANCE}/tags/AI`)
})
