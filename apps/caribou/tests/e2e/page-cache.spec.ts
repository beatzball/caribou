import { expect, test, type Page } from './_fixtures'

// A page the reader comes back to paints from memory at once, then checks
// for changes in the background (issue 101). Every check here holds the
// requests a revisit would otherwise wait for, the way a slow phone network
// does, and expects the cached posts while they are still held.

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: AVATAR, avatar_static: AVATAR,
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function makeStatus(id: string) {
  // Long enough that 30 of them make a page worth scrolling.
  const content = `<p>post ${id}</p>` + '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>'.repeat(3)
  return {
    id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: ACCOUNT, content,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

// Newest first, ids that sort the way Mastodon's do.
const PAGE = Array.from({ length: 30 }, (_, i) => makeStatus(String(1000 - i)))

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const shown = (page: Page) => page.locator('litro-outlet > :not([hidden])')
const cards = (page: Page) => shown(page).locator('caribou-status-card')
const navItem = (page: Page, href: string) => shown(page).locator(`caribou-nav-rail a[href="${href}"]`)

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

interface Hold { release(): void; readonly held: Promise<void> }
function hold(): Hold {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  return { release, held }
}

/**
 * Serves the home timeline: the first page, nothing older, and for a
 * `since_id` check whatever `newer` holds once `gate` opens.
 */
async function serveHome(page: Page, opts: { gate?: Hold; newer?: unknown[] } = {}) {
  await page.route('**/api/v1/timelines/home*', async (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('max_id')) return route.fulfill({ json: [] })
    if (u.searchParams.get('since_id')) {
      await opts.gate?.held
      return route.fulfill({ json: opts.newer ?? [] })
    }
    return route.fulfill({ json: PAGE })
  })
}

test.beforeEach(async ({ page }) => {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN',
    vapidKey: '', account: ACCOUNT, createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
  await page.route('**/a.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
})

test('back to /home shows the cached posts before any request returns, at the old scroll', async ({ page }) => {
  const gate = hold()
  await serveHome(page, { gate, newer: [makeStatus('1001')] })
  await gotoSettled(page, '/home')
  await expect(cards(page)).toHaveCount(30)

  // Wait for the scroll event itself: the router records the position in
  // its own listener, which was added first and so has run by then.
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.addEventListener('scroll', () => resolve(), { once: true })
    window.scrollTo(0, 1200)
  }))
  expect(await page.evaluate(() => window.scrollY)).toBe(1200)

  // A real click would first scroll the nav item into view, and the router
  // would remember that position instead.
  await navItem(page, '/local').dispatchEvent('click', { button: 0 })
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)

  // From now on the page data and the timeline check both hang.
  const pageData = hold()
  await page.route((url) => url.pathname === '/home', async (route) => {
    if (route.request().headers()['accept'] === 'application/json') await pageData.held
    await route.continue()
  })

  await page.goBack()
  await expect(page.locator('litro-outlet > page-home:not([hidden])')).toHaveCount(1, { timeout: 1000 })
  await expect(cards(page)).toHaveCount(30)
  await expect(cards(page).first()).toContainText('post 1000')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200)

  // The newer post goes to the banner. The list under the reader stays put.
  gate.release()
  pageData.release()
  const banner = shown(page).locator('caribou-new-posts-banner button')
  await expect(banner).toHaveText('1 new post')
  await expect(cards(page)).toHaveCount(30)
  await expect(cards(page).first()).toContainText('post 1000')
  expect(await page.evaluate(() => window.scrollY)).toBe(1200)

  await banner.click()
  await expect(cards(page).first()).toContainText('post 1001')
})

test('a link click back to /home is instant too, and starts at the top', async ({ page }) => {
  await serveHome(page)
  await gotoSettled(page, '/home')
  await expect(cards(page)).toHaveCount(30)
  await navItem(page, '/local').click()
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)

  const pageData = hold()
  await page.route((url) => url.pathname === '/home', async (route) => {
    if (route.request().headers()['accept'] === 'application/json') await pageData.held
    await route.continue()
  })
  await navItem(page, '/home').click()
  await expect(page.locator('litro-outlet > page-home:not([hidden])')).toHaveCount(1, { timeout: 1000 })
  await expect(cards(page)).toHaveCount(30)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  pageData.release()
})

test('an old cached page still paints at once and says it is updating', async ({ page }) => {
  await page.clock.install()
  const gate = hold()
  await serveHome(page, { gate })
  await gotoSettled(page, '/home')
  await expect(cards(page)).toHaveCount(30)
  await navItem(page, '/local').click()
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)

  // Six minutes later: past the five-minute limit.
  await page.clock.fastForward('06:00')
  await navItem(page, '/home').click()
  await expect(page.locator('litro-outlet > page-home:not([hidden])')).toHaveCount(1, { timeout: 1000 })
  await expect(cards(page)).toHaveCount(30)
  const notice = page.locator('caribou-update-notice [role="status"]')
  await expect(notice).toHaveText('Updating…')

  gate.release()
  await expect(notice).toHaveText('')
})

// The browser asks for a page's data as JSON on an SPA navigation. These
// tests answer that request themselves, so Local and threads carry real page
// data without an upstream instance.
type Json = Record<string, unknown>
async function servePageData(page: Page, path: string, answer: () => Promise<Json> | Json) {
  await page.route((url) => url.pathname === path, async (route) => {
    if (route.request().headers()['accept'] !== 'application/json') return route.continue()
    return route.fulfill({ json: await answer() })
  })
}

// What a link click does: LitroRouter.go().
async function spaGo(page: Page, path: string) {
  await page.evaluate((p) => {
    history.pushState(null, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

const shell = { instance: INSTANCE }
const localData = (statuses: unknown[]) => ({ kind: 'ok', statuses, nextMaxId: null, shell })

test('back to /local shows the cached posts at once; fresh page data fills the banner', async ({ page }) => {
  await serveHome(page)
  // The signed-in client's own check finds nothing; only page data is new.
  await page.route('**/api/v1/timelines/public*', (route) => route.fulfill({ json: [] }))
  let answer: Promise<Json> | Json = localData(PAGE.slice(0, 5))
  await servePageData(page, '/local', () => answer)
  await gotoSettled(page, '/home')
  await navItem(page, '/local').click()
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)
  await expect(cards(page)).toHaveCount(5)
  await navItem(page, '/home').click()
  await expect(page.locator('litro-outlet > page-home:not([hidden])')).toHaveCount(1)

  const gate = hold()
  answer = gate.held.then(() => localData([makeStatus('1001'), ...PAGE.slice(0, 5)]))
  await page.goBack()
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1, { timeout: 1000 })
  await expect(cards(page)).toHaveCount(5)

  gate.release()
  const banner = shown(page).locator('caribou-new-posts-banner button')
  await expect(banner).toHaveText('1 new post')
  await expect(cards(page)).toHaveCount(5)
  await expect(cards(page).first()).toContainText('post 1000')
})

test('a failed refresh keeps the cached /local list on screen', async ({ page }) => {
  await serveHome(page)
  await page.route('**/api/v1/timelines/public*', (route) => route.fulfill({ json: [] }))
  let answer: Json = localData(PAGE.slice(0, 3))
  await servePageData(page, '/local', () => answer)
  await gotoSettled(page, '/home')
  await navItem(page, '/local').click()
  await expect(cards(page)).toHaveCount(3)
  await navItem(page, '/home').click()
  await expect(page.locator('litro-outlet > page-home:not([hidden])')).toHaveCount(1)

  answer = { kind: 'error', message: 'upstream down', shell }
  // Wait for the failed refresh itself: without it the checks below would
  // also pass if no refresh ran at all.
  const failed = page.waitForResponse((r) =>
    new URL(r.url()).pathname === '/local' && r.request().headers()['accept'] === 'application/json')
  await navItem(page, '/local').click()
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)
  expect(await (await failed).json()).toMatchObject({ kind: 'error' })
  await expect(cards(page)).toHaveCount(3)
  // Away and back once more: the error was not kept either.
  await navItem(page, '/home').click()
  await navItem(page, '/local').click()
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)
  await expect(cards(page)).toHaveCount(3)
  await expect(shown(page).getByText("Couldn't load /local")).toHaveCount(0)
})

test('back to a thread shows it at once, then adds the new reply at the end', async ({ page }) => {
  const path = `/@alice@${INSTANCE}/1000`
  const focused = makeStatus('1000')
  const reply = (id: string) => ({ ...makeStatus(id), in_reply_to_id: '1000' })
  const thread = (descendants: unknown[]) => ({
    kind: 'ok', focused, ancestors: [], descendants, shell, statusId: '1000', handle: `alice@${INSTANCE}`,
  })
  await serveHome(page)
  let answer: Promise<Json> | Json = thread([reply('1001')])
  await servePageData(page, path, () => answer)
  await gotoSettled(page, '/home')
  await spaGo(page, path)
  const threadCards = shown(page).locator('caribou-thread caribou-status-card')
  await expect(threadCards).toHaveCount(2)
  await navItem(page, '/home').click()
  await expect(page.locator('litro-outlet > page-home:not([hidden])')).toHaveCount(1)

  const gate = hold()
  answer = gate.held.then(() => thread([reply('1001'), reply('1002')]))
  await page.goBack()
  await expect(page.locator('litro-outlet > page-handle-statusid:not([hidden])')).toHaveCount(1, { timeout: 1000 })
  await expect(threadCards).toHaveCount(2)

  gate.release()
  await expect(threadCards).toHaveCount(3)
  await expect(threadCards.nth(0)).toHaveAttribute('data-id', '1000')
  await expect(threadCards.nth(2)).toHaveAttribute('data-id', '1002')
})
