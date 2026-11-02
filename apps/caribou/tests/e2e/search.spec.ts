import { expect, test, type Page, type Route } from './_fixtures.js'

const INSTANCE = 'example.social'

const account = (id: string, acct: string, name: string) => ({
  id, username: acct.split('@')[0], acct, display_name: name,
  avatar: `https://${INSTANCE}/a.png`, avatar_static: `https://${INSTANCE}/a.png`,
  url: `https://other.social/@${acct.split('@')[0]}`, uri: `https://other.social/users/${acct.split('@')[0]}`,
  header: '', header_static: '', note: '', followers_count: 0, following_count: 0, statuses_count: 0,
  locked: false, bot: false, discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
})

const BOB = account('b1', 'bob@other.social', 'Bob Example')

const status = (id: string, text: string) => ({
  id, uri: `https://other.social/users/bob/statuses/${id}`, url: `https://other.social/@bob/${id}`,
  created_at: '2024-01-01T00:00:00.000Z', account: BOB, content: `<p>${text}</p>`,
  visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], mentions: [], tags: [],
  emojis: [], reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
})

const json = (body: unknown) => ({
  status: 200, contentType: 'application/json', body: JSON.stringify(body),
  headers: { 'access-control-allow-origin': '*' },
})

async function signIn(page: Page) {
  await page.addInitScript(() => {
    const session = {
      userKey: 'alice@example.social', server: 'example.social', token: 'TOKEN', vapidKey: '',
      account: { id: 'a1', username: 'alice', acct: 'alice' }, createdAt: 1,
    }
    localStorage.setItem('caribou.users', JSON.stringify([[session.userKey, session]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(session.userKey))
  })
  await page.route(`https://${INSTANCE}/api/v1/accounts/relationships*`, (route) =>
    route.fulfill(json([{ id: 'b1', following: false, requested: false, blocking: false, followed_by: false }])))
}

type Answer = (q: string, url: URL) => unknown
async function answerSearch(page: Page, answer: Answer, seen: URL[] = []) {
  await page.route(`https://${INSTANCE}/api/v2/search*`, async (route: Route) => {
    const url = new URL(route.request().url())
    seen.push(url)
    const body = await answer(url.searchParams.get('q') ?? '', url)
    await route.fulfill(json(body))
  })
  return seen
}

async function settled(page: Page) {
  await page.waitForSelector('litro-outlet[data-litro-settled]', { state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

const search = (page: Page) => page.locator('litro-outlet > :not([hidden]) caribou-search')
const results = (page: Page) => search(page).locator('.results')
const tab = (page: Page, name: string) => search(page).locator('.tabs a', { hasText: name })

const everything = () => ({
  accounts: [BOB],
  statuses: [status('s1', 'a post about bob')],
  hashtags: [{ name: 'bobcats', url: 'https://example.social/tags/bobcats', history: [{ day: '1', uses: '4', accounts: '2' }] }],
})

test('type, see People, switch tabs, and Back returns to the earlier tab', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await signIn(page)
  const seen = await answerSearch(page, everything)
  await page.goto('/search')
  await settled(page)
  await expect(results(page)).toContainText('Search for people, hashtags and posts.')
  await search(page).locator('input[name="q"]').fill('bob')
  await expect(results(page).locator('.account .acct')).toHaveText('@bob@other.social')
  await expect(page).toHaveURL(/\/search\?q=bob$/)
  expect(seen.at(-1)!.searchParams.get('resolve')).toBeNull()
  await expect(results(page).locator('caribou-button.follow')).toHaveAttribute('data-state', 'follow')

  expect(seen).toHaveLength(1)
  await tab(page, 'Hashtags').click()
  await expect(page).toHaveURL(/\/search\?q=bob&type=hashtags$/)
  await expect(tab(page, 'Hashtags')).toHaveAttribute('aria-current', 'page')
  await expect(results(page).locator('a.tag')).toHaveAttribute('href', '/tags/bobcats')

  await tab(page, 'Posts').click()
  await expect(results(page).locator('caribou-status-card')).toContainText('a post about bob')
  expect(seen).toHaveLength(1)

  await page.goBack()
  await expect(page).toHaveURL(/type=hashtags$/)
  await expect(tab(page, 'Hashtags')).toHaveAttribute('aria-current', 'page')
  await expect(results(page).locator('a.tag')).toBeVisible()
  // Typing searched once; a tab change reads the same answer. (Back may
  // build the page again, which searches again.)
  expect(seen.length).toBeLessThanOrEqual(2)
  expect(errors).toEqual([])
})

test('a deep link opens the tab and the query it names', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await signIn(page)
  await answerSearch(page, everything)
  await page.goto('/search?q=bob&type=hashtags')
  await settled(page)
  await expect(search(page).locator('input[name="q"]')).toHaveValue('bob')
  await expect(tab(page, 'Hashtags')).toHaveAttribute('aria-current', 'page')
  await expect(results(page).locator('a.tag .tag-name')).toHaveText('#bobcats')
  await expect(results(page)).toContainText('4 posts this week')
  expect(errors).toEqual([])
})

test('pasting a post address opens its thread in the app', async ({ page }) => {
  await signIn(page)
  const seen = await answerSearch(page, (q) =>
    q === 'https://other.social/@bob/77' ? { accounts: [], statuses: [status('77', 'resolved post')], hashtags: [] } : everything())
  await page.route(`https://${INSTANCE}/api/v1/statuses/77*`, (route) => route.fulfill(json(status('77', 'resolved post'))))
  await page.route(`https://${INSTANCE}/api/v1/statuses/77/context*`, (route) =>
    route.fulfill(json({ ancestors: [], descendants: [] })))
  await page.goto('/search')
  await settled(page)
  const input = search(page).locator('input[name="q"]')
  await input.focus()
  // A paste is an input event with inputType insertFromPaste.
  await input.evaluate((el: HTMLInputElement) => {
    el.value = 'https://other.social/@bob/77'
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true, composed: true }))
  })
  await expect(page).toHaveURL(/\/@bob@other\.social\/77$/)
  expect(seen.at(-1)!.searchParams.get('resolve')).toBe('true')
  await expect(page.locator('litro-outlet > page-handle-statusid')).toHaveCount(1)
})

test('a deep link to a profile address opens the profile, and Back skips the search', async ({ page }) => {
  await signIn(page)
  await answerSearch(page, () => ({ accounts: [BOB], statuses: [], hashtags: [] }))
  await page.route(`https://${INSTANCE}/api/v1/accounts/**`, (route) => route.fulfill(json([])))
  await page.goto('/about')
  await settled(page)
  await page.goto(`/search?q=${encodeURIComponent('https://other.social/@bob')}`)
  await expect(page).toHaveURL(/\/@bob@other\.social$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/about$/)
})

test('a slower earlier answer never replaces a newer one', async ({ page }) => {
  await signIn(page)
  let releaseSlow!: () => void
  const slow = new Promise<void>((r) => { releaseSlow = r })
  await answerSearch(page, async (q) => {
    if (q === 'ca') {
      await slow
      return { accounts: [account('o1', 'old', 'Old Answer')], statuses: [], hashtags: [] }
    }
    return { accounts: [account('c1', 'carol', 'Carol')], statuses: [], hashtags: [] }
  })
  await page.goto('/search?q=ca')
  await settled(page)
  await expect(results(page)).toContainText('Searching…')
  await search(page).locator('input[name="q"]').fill('carol')
  await search(page).locator('input[name="q"]').press('Enter')
  await expect(results(page).locator('.account .name')).toHaveText('Carol')
  releaseSlow()
  await page.waitForTimeout(300)
  await expect(results(page).locator('.account .name')).toHaveText('Carol')
  await expect(page).toHaveURL(/q=carol$/)
})

test('signed out with no known server, search asks to sign in', async ({ page }) => {
  await page.goto('/search?q=bob')
  await settled(page)
  await expect(results(page).locator('caribou-auth-required')).toContainText('Search needs to know which server to ask')
})

// The server trusts the instance cookie only for a server it has an app
// for, which the test server has not; the page data carries the instance
// on a client-side move instead.
test('signed out, searches the public server with no token', async ({ page }) => {
  const seen: { auth: string | undefined; url: URL }[] = []
  await page.route(`https://${INSTANCE}/api/v2/search*`, (route) => {
    seen.push({ auth: route.request().headers()['authorization'], url: new URL(route.request().url()) })
    return route.fulfill(json({ accounts: [account('b1', 'bob', 'Bob')], statuses: [], hashtags: [] }))
  })
  await page.route((url) => url.pathname === '/search', (route) => {
    if (!/application\/json/.test(route.request().headers()['accept'] ?? '')) return route.continue()
    return route.fulfill(json({ shell: { instance: INSTANCE }, q: 'bob', type: 'accounts' }))
  })
  await page.goto('/about')
  await settled(page)
  await page.evaluate(() => {
    history.pushState(null, '', '/search?q=bob')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(results(page).locator('.account .acct')).toHaveText('@bob@example.social')
  expect(seen[0]!.auth).toBeUndefined()
  expect(seen[0]!.url.searchParams.get('resolve')).toBeNull()
  await expect(results(page).locator('caribou-button.follow')).toHaveCount(0)
  await tab(page, 'Posts').click()
  await expect(results(page)).toContainText('Sign in to search posts.')
})

test('the right rail search box opens /search', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page)
  await answerSearch(page, everything)
  await page.goto('/about')
  await settled(page)
  const box = page.locator('litro-outlet > :not([hidden]) caribou-right-rail input[name="q"]')
  await box.fill('bob')
  await box.press('Enter')
  await expect(page).toHaveURL(/\/search\?q=bob$/)
  await expect(results(page).locator('.account .acct')).toHaveText('@bob@other.social')
})

// Review round 1 (Codex 1): a link click while a typed query waits. The
// router keeps the search page while it loads the next page's data; the
// waiting query must not write the address in that time.
test('leaving /search while a typed query waits keeps the new address', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page)
  const seen = await answerSearch(page, everything)
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route((url) => url.pathname === '/about', async (route) => {
    if (!/application\/json/.test(route.request().headers()['accept'] ?? '')) return route.continue()
    await held
    return route.continue()
  })
  await page.goto('/search')
  await settled(page)
  await search(page).locator('input[name="q"]').fill('new')
  await page.locator('litro-outlet > :not([hidden]) caribou-right-rail litro-link[href="/about"]').click()
  await page.waitForTimeout(600)
  expect(new URL(page.url()).pathname).toBe('/about')
  release()
  await expect(page.locator('litro-outlet > page-about')).toHaveCount(1)
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/about')
  expect(seen.map((u) => u.searchParams.get('q'))).not.toContain('new')
})
