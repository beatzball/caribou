import { expect, test, type Page } from './_fixtures.js'

// A 401 names the session of the client that got it (issue #76), by its
// sign-in (`generation`). Only a 401 for the active session signs the user out
// of it (to the next stored account, or to `/` when none is left); one for
// another stored session, or for a sign-in that was replaced, must not touch
// the active one. A 401 keeps the session's drafts; only a sign-out deletes
// them (session rules in packages/state/README.md).

const INSTANCE = 'example.social'
const ALICE = `alice@${INSTANCE}`
const BOB = `bob@${INSTANCE}`

const BOB_ACCOUNT = {
  id: 'b1', username: 'bob', acct: 'bob', display_name: 'Bob Example',
  avatar: '', avatar_static: '', url: `https://${INSTANCE}/@bob`, header: '', header_static: '',
  note: '', followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

const STATUS = {
  id: '1', uri: `https://${INSTANCE}/@bob/1`, url: `https://${INSTANCE}/@bob/1`,
  created_at: '2024-01-01T00:00:00.000Z', account: BOB_ACCOUNT, content: '<p>bob was here</p>',
  visibility: 'public', sensitive: false, spoiler_text: '',
  media_attachments: [], mentions: [], tags: [], emojis: [],
  reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
}

// Two sessions as sign-in stores them (`account: null`); bob signed in last,
// so bob is active.
function seed(page: Page) {
  const alice = { userKey: ALICE, server: INSTANCE, token: 'TOKEN-A', generation: 'GEN-A', vapidKey: '', account: null, createdAt: 1 }
  const bob = { userKey: BOB, server: INSTANCE, token: 'TOKEN-B', generation: 'GEN-B', vapidKey: '', account: null, createdAt: 2 }
  // Seed once: the 401 redirect loads `/` in the same context.
  return page.addInitScript((data) => {
    if (localStorage.getItem('caribou.__seeded__') === '1') return
    localStorage.setItem('caribou.users', JSON.stringify([[data.alice.userKey, data.alice], [data.bob.userKey, data.bob]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.bob.userKey))
    localStorage.setItem(`caribou.drafts.${data.alice.userKey}`, '[]')
    localStorage.setItem(`caribou.drafts.${data.bob.userKey}`, '[]')
    localStorage.setItem('caribou.__seeded__', '1')
  }, { alice, bob })
}

test.beforeEach(async ({ page }) => {
  await seed(page)
  await page.route('**/api/v1/accounts/verify_credentials', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOB_ACCOUNT) }))
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const body = u.searchParams.get('since_id') || u.searchParams.get('max_id') ? [] : [STATUS]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(page.getByText('bob was here')).toBeVisible()
})

// What a client does when its request gets a 401 (`emitUnauthorized` in
// `packages/state/src/users.ts`). Today only the active session has a client,
// so a request that outlives a switch is the only way to get here; firing the
// event stands in for that request.
function unauthorized(page: Page, userKey: string, generation: string, type = 'caribou:unauthorized') {
  return page.evaluate(([userKey, generation, type]) => {
    window.dispatchEvent(new CustomEvent(type, { detail: { userKey, generation } }))
  }, [userKey, generation, type] as const)
}

function stored(page: Page) {
  return page.evaluate(() => ({
    keys: (JSON.parse(localStorage.getItem('caribou.users') ?? '[]') as [string, unknown][]).map(([k]) => k),
    active: JSON.parse(localStorage.getItem('caribou.activeUserKey') ?? 'null') as string | null,
    expired: (JSON.parse(localStorage.getItem('caribou.users') ?? '[]') as [string, { expired?: true }][])
      .filter(([, s]) => s.expired).map(([k]) => k),
    aliceDrafts: localStorage.getItem('caribou.drafts.alice@example.social'),
    bobDrafts: localStorage.getItem('caribou.drafts.bob@example.social'),
  }))
}

test('a 401 for the non-active session removes only that session, without a redirect', async ({ page }) => {
  await unauthorized(page, ALICE, 'GEN-A')
  await expect.poll(() => stored(page)).toEqual({
    keys: [BOB], active: BOB, expired: [], aliceDrafts: '[]', bobDrafts: '[]',
  })
  expect(new URL(page.url()).pathname).toBe('/home')
  await expect(page.getByText('bob was here')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a 401 for a replaced sign-in changes nothing; a real one moves to the other account, then to /', async ({ page }) => {
  await unauthorized(page, BOB, 'GEN-OLD')
  expect(await stored(page)).toEqual({
    keys: [ALICE, BOB], active: BOB, expired: [], aliceDrafts: '[]', bobDrafts: '[]',
  })
  await expect(page.getByText('bob was here')).toBeVisible()

  // A real 401 for the active account: alice is still stored, so the page
  // reloads signed in as alice, with no "signed out" banner.
  const reloaded = page.waitForEvent('framenavigated', (f) => f === page.mainFrame())
  await unauthorized(page, BOB, 'GEN-B')
  await reloaded
  expect(await stored(page)).toEqual({
    keys: [ALICE], active: ALICE, expired: [], aliceDrafts: '[]', bobDrafts: '[]',
  })
  expect(new URL(page.url()).pathname).toBe('/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.getByRole('alert')).toHaveCount(0)

  // A 401 for the last account signs out to the landing page.
  await unauthorized(page, ALICE, 'GEN-A')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  await expect(page.getByRole('alert')).toContainText(/session expired|sign in again/i)
  expect(await stored(page)).toEqual({
    keys: [], active: null, expired: [], aliceDrafts: '[]', bobDrafts: '[]',
  })
})

test('an expiry keeps the session, its drafts and the page; an old one is ignored', async ({ page }) => {
  // From an earlier sign-in: nothing changes.
  await unauthorized(page, BOB, 'GEN-OLD', 'caribou:session-expired')
  expect(await stored(page)).toEqual({
    keys: [ALICE, BOB], active: BOB, expired: [], aliceDrafts: '[]', bobDrafts: '[]',
  })

  let navigated = false
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated = true })
  await unauthorized(page, BOB, 'GEN-B', 'caribou:session-expired')
  await expect.poll(() => stored(page)).toEqual({
    keys: [ALICE, BOB], active: BOB, expired: [BOB], aliceDrafts: '[]', bobDrafts: '[]',
  })
  expect(navigated).toBe(false)
  expect(new URL(page.url()).pathname).toBe('/home')
  await expect(page.getByText('bob was here')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

// Session rule 2: storage decides. Two pages in one context share
// localStorage, not memory. Page B stands in for another tab that signs in
// again, then signs out, the way the sign-in page and sign-out write storage.
test('another tab: an old 401 or expiry never undoes its sign-in or sign-out', async ({ page, context }) => {
  const other = await context.newPage()
  // Page B never reaches a real server: every request to the instance is answered here.
  await other.route(`https://${INSTANCE}/**`, (route) => {
    const path = new URL(route.request().url()).pathname
    const body = path === '/api/v1/accounts/verify_credentials' ? BOB_ACCOUNT : []
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await other.goto('/home')
  await other.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })

  // Page B signs bob in again: a new generation and token.
  await other.evaluate((bob) => {
    const users = JSON.parse(localStorage.getItem('caribou.users')!) as [string, Record<string, unknown>][]
    localStorage.setItem('caribou.users', JSON.stringify(users.map(([k, s]) =>
      [k, k === bob ? { ...s, token: 'TOKEN-B2', generation: 'GEN-B2' } : s])))
  }, BOB)
  const tokens = () => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('caribou.users') ?? '[]') as [string, { token: string }][])
      .map(([k, s]) => [k, s.token]))

  let navigated = false
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated = true })
  // Page A still has bob's old sign-in in memory. Its 401 and expiry are stale.
  await unauthorized(page, BOB, 'GEN-B')
  await unauthorized(page, BOB, 'GEN-B', 'caribou:session-expired')
  expect(await stored(page)).toEqual({
    keys: [ALICE, BOB], active: BOB, expired: [], aliceDrafts: '[]', bobDrafts: '[]',
  })
  expect(await tokens()).toEqual([[ALICE, 'TOKEN-A'], [BOB, 'TOKEN-B2']])

  // Page B signs out of bob. An old expiry on page A must not bring bob's token back.
  await other.evaluate((bob) => {
    const users = JSON.parse(localStorage.getItem('caribou.users')!) as [string, unknown][]
    localStorage.setItem('caribou.users', JSON.stringify(users.filter(([k]) => k !== bob)))
    localStorage.removeItem(`caribou.drafts.${bob}`)
  }, BOB)
  await unauthorized(page, BOB, 'GEN-B', 'caribou:session-expired')
  await unauthorized(page, BOB, 'GEN-B')
  expect(await tokens()).toEqual([[ALICE, 'TOKEN-A']])
  expect(navigated).toBe(false)
  await other.close()
})
