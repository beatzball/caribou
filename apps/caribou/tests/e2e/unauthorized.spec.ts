import { expect, test, type Page } from '@playwright/test'

// A 401 names the session of the client that got it (issue #76). Only a 401
// for the active session signs the user out; one for another stored session,
// or for a token that was replaced, must not touch the active one.

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
  const alice = { userKey: ALICE, server: INSTANCE, token: 'TOKEN-A', vapidKey: '', account: null, createdAt: 1 }
  const bob = { userKey: BOB, server: INSTANCE, token: 'TOKEN-B', vapidKey: '', account: null, createdAt: 2 }
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
function unauthorized(page: Page, userKey: string, token: string) {
  return page.evaluate(([userKey, token]) => {
    window.dispatchEvent(new CustomEvent('caribou:unauthorized', { detail: { userKey, token } }))
  }, [userKey, token] as const)
}

function stored(page: Page) {
  return page.evaluate(() => ({
    keys: (JSON.parse(localStorage.getItem('caribou.users') ?? '[]') as [string, unknown][]).map(([k]) => k),
    active: JSON.parse(localStorage.getItem('caribou.activeUserKey') ?? 'null') as string | null,
    aliceDrafts: localStorage.getItem('caribou.drafts.alice@example.social'),
    bobDrafts: localStorage.getItem('caribou.drafts.bob@example.social'),
  }))
}

test('a 401 for the non-active session removes only that session, without a redirect', async ({ page }) => {
  await unauthorized(page, ALICE, 'TOKEN-A')
  await expect.poll(() => stored(page)).toEqual({
    keys: [BOB], active: BOB, aliceDrafts: null, bobDrafts: '[]',
  })
  expect(new URL(page.url()).pathname).toBe('/home')
  await expect(page.getByText('bob was here')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a 401 for a replaced token changes nothing, and a later real 401 still signs out', async ({ page }) => {
  await unauthorized(page, BOB, 'TOKEN-OLD')
  expect(await stored(page)).toEqual({
    keys: [ALICE, BOB], active: BOB, aliceDrafts: '[]', bobDrafts: '[]',
  })
  await expect(page.getByText('bob was here')).toBeVisible()

  await unauthorized(page, BOB, 'TOKEN-B')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  await expect(page.getByRole('alert')).toContainText(/session expired|sign in again/i)
  expect(await stored(page)).toEqual({
    keys: [ALICE], active: null, aliceDrafts: '[]', bobDrafts: null,
  })
})
