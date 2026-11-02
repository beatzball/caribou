// Mocks shared by moderation.spec.ts and moderation.mobile.spec.ts.
import { expect, type Page } from './_fixtures.js'

export const INSTANCE = 'example.social'
export const API = `https://${INSTANCE}/api`

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function account(id: string, username: string) {
  return {
    id, username, acct: username, display_name: username.toUpperCase(),
    avatar: `https://${INSTANCE}/a.png`, avatar_static: `https://${INSTANCE}/a.png`,
    url: `https://${INSTANCE}/@${username}`, header: '', header_static: '', note: '',
    followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
    discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
  }
}

export const ALICE = account('a1', 'alice')
export const BOB = account('b1', 'bob')
export const CAROL = account('c1', 'carol')

export function match(title: string, action: 'warn' | 'hide', context: string[]) {
  return {
    filter: { id: title, title, context, filter_action: action, expires_at: null, keywords: [], statuses: [] },
    keyword_matches: ['x'], status_matches: null,
  }
}

export function status(id: string, author: typeof BOB, filtered?: unknown[]) {
  return {
    id, uri: `https://${INSTANCE}/@${author.username}/${id}`, url: `https://${INSTANCE}/@${author.username}/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: author, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
    ...(filtered ? { filtered } : {}),
  }
}

export function relationship(id: string, patch: Record<string, unknown> = {}) {
  return {
    id, following: false, showing_reblogs: false, notifying: false, languages: [],
    followed_by: false, blocking: false, blocked_by: false, muting: false,
    muting_notifications: false, requested: false, requested_by: false,
    domain_blocking: false, endorsed: false, note: '', ...patch,
  }
}

export const json = (body: unknown, headers: Record<string, string> = {}) =>
  ({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers })

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
}

export async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  return errors
}

export const card = (page: Page, id: string) => page.locator(`caribou-status-card[data-status-id="${id}"]`)

export async function homeWith(page: Page, statuses: unknown[]) {
  // Only the first page: the scroll sentinel asks for older ones, and a poll for newer.
  await page.route(`${API}/v1/timelines/home*`, (route) => {
    const q = new URL(route.request().url()).searchParams
    return route.fulfill(json(q.has('max_id') || q.has('since_id') ? [] : statuses))
  })
  await gotoSettled(page, '/home')
}
