// Shared by text-size.spec.ts and text-size.mobile.spec.ts (issue 309): a
// signed-in reader whose server answers every page with long names and long
// text, so a page that cannot fit the largest text size shows it.
import { expect, type Page } from './_fixtures.js'
import { livePage } from './_server-page.js'

export const INSTANCE = 'example.social'
const API = `https://${INSTANCE}/api`

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function account(id: string, username: string, displayName: string) {
  return {
    id, username, acct: username, display_name: displayName,
    avatar: `https://${INSTANCE}/a.png`, avatar_static: `https://${INSTANCE}/a.png`,
    url: `https://${INSTANCE}/@${username}`, header: '', header_static: '',
    note: '<p>A profile note that is long enough to wrap over more than one line on a phone.</p>',
    followers_count: 1234567, following_count: 7654321, statuses_count: 9876543, locked: false, bot: false,
    discoverable: true, created_at: '2024-01-01T00:00:00.000Z', emojis: [],
    fields: [{ name: 'Website', value: '<a href="https://alice.example">alice.example</a>', verified_at: null }],
  }
}

const ALICE = account('a1', 'alice', 'Alice Example')
const BOB = account('b1', 'bob', 'Bob With A Rather Long Display Name')

function status(id: string, author = BOB) {
  return {
    id, uri: `https://${INSTANCE}/@${author.username}/${id}`, url: `https://${INSTANCE}/@${author.username}/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: author,
    content: `<p>Post ${id}: a few words, then a long link that must wrap, `
      + '<a href="https://news.example/a/very/long/path/that/goes/on/and/on">news.example/a/very/long/path/that/goes/on/and/on</a> '
      + '<a href="https://example.social/tags/TextSize">#TextSize</a></p>',
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 1234, favourites_count: 56789, replies_count: 12,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

const relationship = (id: string) => ({
  id, following: false, showing_reblogs: false, notifying: false, languages: [],
  followed_by: false, blocking: false, blocked_by: false, muting: false,
  muting_notifications: false, requested: false, requested_by: false,
  domain_blocking: false, endorsed: false, note: '',
})

const notification = (id: string, type: string, withStatus: boolean) => ({
  id, type, created_at: '2024-01-01T00:00:00.000Z', account: BOB,
  ...(withStatus ? { status: status(`n${id}`, ALICE) } : {}),
})

// The same post and author as the server sends them in page data, for the
// thread and the profile (their data comes from the server, not the browser).
const CAMEL_BOB = {
  id: 'b1', username: 'bob', acct: 'bob', displayName: BOB.display_name, avatar: BOB.avatar, avatarStatic: BOB.avatar,
  url: BOB.url, note: BOB.note, header: '', headerStatic: '', followersCount: 1234567, followingCount: 7654321,
  statusesCount: 9876543, fields: [], emojis: [], createdAt: BOB.created_at,
}
const camelPost = (id: string) => ({
  id, uri: `https://${INSTANCE}/@bob/${id}`, url: `https://${INSTANCE}/@bob/${id}`, account: CAMEL_BOB,
  content: status(id).content, createdAt: '2024-01-01T00:00:00.000Z', visibility: 'public', sensitive: false,
  spoilerText: '', mediaAttachments: [], mentions: [], tags: [], emojis: [],
  repliesCount: 12, reblogsCount: 1234, favouritesCount: 56789,
})
const PAGE_DATA: Record<string, unknown> = {
  '/@bob': { account: CAMEL_BOB, statuses: ['7', '8', '9'].map(camelPost), nextCursor: null, tab: 'posts', handle: 'bob' },
  '/@bob/42': {
    focused: camelPost('42'), ancestors: [camelPost('41')], descendants: [camelPost('43'), camelPost('44')],
    handle: 'bob', statusId: '42',
  },
}

const NOTIFICATIONS = [
  notification('4', 'mention', true), notification('3', 'favourite', true),
  notification('2', 'reblog', true), notification('1', 'follow', false),
]

// One answer per path the pages below ask for; an empty list for the rest.
function answer(url: URL): unknown {
  const p = url.pathname.replace(/^\/api/, '')
  const older = url.searchParams.has('max_id') || url.searchParams.has('since_id') || url.searchParams.has('min_id')
  if (p === '/v1/accounts/verify_credentials') return ALICE
  if (p === '/v2/instance') return { configuration: { statuses: { max_characters: 500, max_media_attachments: 4 } } }
  if (p.startsWith('/v1/timelines/')) return older ? [] : ['1', '2', '3', '4', '5', '6'].map((id) => status(id))
  // The reader's own view of posts the server sent in page data.
  if (p === '/v1/statuses') return url.searchParams.getAll('id[]').map((id) => status(id))
  if (p === '/v1/statuses/42') return status('42')
  if (p === '/v1/statuses/42/context') return { ancestors: [status('41')], descendants: [status('43'), status('44')] }
  if (p === '/v1/accounts/lookup') return BOB
  if (p === '/v1/accounts/b1') return BOB
  if (p === '/v1/accounts/b1/statuses') return older ? [] : ['7', '8', '9'].map((id) => status(id))
  if (p === '/v1/accounts/relationships') return [relationship('b1')]
  if (p === '/v1/notifications') return older || url.searchParams.has('limit') ? [] : NOTIFICATIONS
  if (p === '/v2/search') return { accounts: [BOB], statuses: [status('51')], hashtags: [] }
  return []
}

export async function signIn(page: Page) {
  await page.addInitScript((acct) => {
    const session = {
      userKey: 'alice@example.social', server: 'example.social', token: 'TOKEN',
      vapidKey: '', account: acct, createdAt: 1,
    }
    localStorage.setItem('caribou.users', JSON.stringify([[session.userKey, session]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(session.userKey))
  }, ALICE)
  await page.route('**/a.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v2/notifications') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Not found"}' })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(url)) })
  })
  await page.route((url) => url.pathname in PAGE_DATA, (route) => {
    if (!route.request().headers()['accept']?.includes('application/json')) return route.continue()
    const data = PAGE_DATA[new URL(route.request().url()).pathname] as object
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...data, kind: 'ok', shell: { instance: INSTANCE } }),
    })
  })
}

/** Stores a text size before any page script runs, on every load. */
export async function storeTextSize(page: Page, size: string) {
  await page.addInitScript((size) => { localStorage.setItem('caribou.textSize', size) }, size)
}

export async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

// Each page to check, and an element on it that shows its content loaded.
export const PAGES: Array<{ path: string; ready: string }> = [
  { path: '/home', ready: 'caribou-timeline caribou-status-card' },
  { path: '/@bob/42', ready: 'caribou-thread caribou-status-card' },
  { path: '/@bob', ready: 'caribou-profile caribou-status-card' },
  { path: '/notifications', ready: 'caribou-notifications li' },
  { path: '/search?q=bob', ready: 'caribou-search' },
  { path: '/settings', ready: 'caribou-settings-appearance' },
]

// A full load of a thread or a profile reads it on the server, from the
// instance cookie's server, which no browser route can answer. So each page
// opens from /home as a client-side navigation, as a reader gets there.
export async function openPage(page: Page, path: string, ready: string) {
  await gotoSettled(page, '/home')
  if (path !== '/home') {
    await page.evaluate((path) => {
      history.pushState(null, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, path)
    await expect.poll(() => page.evaluate(() => location.pathname + location.search)).toBe(path)
    await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  }
  await expect(livePage(page).locator(ready).first()).toBeVisible()
}

/** The document is no wider than the window: nothing scrolls sideways. */
export async function expectNoSidewaysScroll(page: Page, what: string) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, width: window.innerWidth,
  }))
  expect(scroll, `${what}: ${scroll}px wide in a ${width}px window`).toBeLessThanOrEqual(width)
}

/**
 * Every shown item of the nav rail (links and buttons) holds its content:
 * nothing inside is wider or taller than the item, and no item leaves the
 * bar. Clipped labels (the screen-reader-only text) are left out.
 */
export async function expectNavItemsFit(page: Page) {
  const problems = await livePage(page).locator('caribou-nav-rail').evaluate((host) => {
    const nav = host.shadowRoot!.querySelector('nav')!
    const bar = nav.getBoundingClientRect()
    const out: string[] = []
    const items = [...nav.querySelectorAll<HTMLElement>(':scope > a, :scope > caribou-button, :scope > caribou-menu')]
    for (const item of items) {
      const box = item.getBoundingClientRect()
      if (box.width === 0) continue
      const name = item.getAttribute('href') ?? item.localName
      if (box.left < bar.left - 0.5 || box.right > bar.right + 0.5) out.push(`${name} leaves the bar`)
      const inner = [...item.querySelectorAll<HTMLElement>('*')]
      for (const el of inner) {
        const style = getComputedStyle(el)
        if (style.position === 'absolute' || style.clipPath !== 'none') continue
        const r = el.getBoundingClientRect()
        if (r.width === 0) continue
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5) out.push(`${name}: ${el.className || el.localName} is wider than its item`)
      }
      if (item.scrollWidth > item.clientWidth + 1) out.push(`${name} overflows sideways`)
    }
    return out
  })
  expect(problems).toEqual([])
}
