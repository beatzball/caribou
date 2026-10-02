import { expect, test, type Page } from '@playwright/test'

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

const SAMPLE_ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: AVATAR, avatar_static: AVATAR,
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function makeStatus(id: string, content = `<p>post ${id}</p>`) {
  return {
    id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: SAMPLE_ACCOUNT, content,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

// 1×1 transparent PNG, so an avatar request succeeds and the card's
// retry-on-error path stays out of the request counts.
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

// A full page load mounts the page twice: the router hydrates the
// server-rendered <page-home>, builds a second one, then swaps them. While
// both are mounted each one fetches and the same post text is in the DOM
// twice. Wait until the router has settled on one page.
async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test.beforeEach(async ({ page }) => {
  const session = {
    userKey: `alice@${INSTANCE}`,
    server: INSTANCE,
    token: 'TOKEN',
    vapidKey: '',
    account: SAMPLE_ACCOUNT,
    createdAt: 1,
  }
  // `addInitScript` runs on every new document in the context, including
  // post-redirect navigations inside a single test. The 401-interceptor
  // test asserts that `removeActiveUser()` clears the active key — so if
  // we blindly re-seed on the redirect target (`/`), localStorage is
  // restored before the assertion reads it. Guard with a sentinel that
  // survives same-context navigations (localStorage is per-origin, so
  // it persists across the replace).
  await page.addInitScript((data) => {
    if (localStorage.getItem('caribou.__seeded__') === '1') return
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
    localStorage.setItem('caribou.__seeded__', '1')
  }, session)
  await page.route('**/a.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
})

test('/feed 301-redirects to /home', async ({ page }) => {
  await page.goto('/feed')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/home')
})

test('/home without activeUserKey shows the auth-required placeholder', async ({ page, context }) => {
  // Clear the seed from beforeEach for this one test.
  await context.clearCookies()
  await page.addInitScript(() => {
    localStorage.removeItem('caribou.users')
    localStorage.removeItem('caribou.activeUserKey')
  })
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  // Signed-out users land on a placeholder that explains the auth
  // requirement instead of a hard redirect to /.
  await expect(page.getByText(/requires a Mastodon access token/i)).toBeVisible()
  await expect(page.locator('caribou-timeline')).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe('/home')
  expect(errors).toEqual([])
})

test('/home server-renders the placeholder, with or without a session', async ({ request }) => {
  // The token lives only in the browser; the server cannot render a timeline.
  const body = await (await request.get('/home')).text()
  expect(body).toContain('requires a Mastodon access token')
  expect(body).not.toContain('<caribou-timeline')
})

test('/home with activeUserKey renders timeline statuses from the fake Mastodon API', async ({ page }) => {
  // Note: `/api/v1/timelines/home` is the Mastodon API endpoint for the
  // "home" timeline type — unrelated to our page route. Do not rename it.
  // The "Older posts →" anchor is initially in view when the timeline is
  // short, so the IntersectionObserver fires `loadMore()` immediately —
  // mocks MUST return `[]` for `max_id` requests, otherwise `loadMore()`
  // re-appends the same statuses and the timeline duplicates them.
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('since_id') || u.searchParams.get('max_id')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([makeStatus('a', '<p>hello world</p>'), makeStatus('b', '<p>second post</p>')]),
    })
  })
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  // Playwright pierces open shadow roots from getByText, so the post's <p>
  // inside the card's shadow root is reachable directly.
  await expect(page.getByText('hello world')).toBeVisible()
  await expect(page.getByText('second post')).toBeVisible()
  // The placeholder is gone, replaced by exactly one timeline.
  await expect(page.getByText(/requires a Mastodon access token/i)).toHaveCount(0)
  await expect(page.locator('caribou-timeline[kind="home"]')).toHaveCount(1)
  await expect(page.locator('caribou-status-card')).toHaveCount(2)
  // The empty next page ends the timeline: the pagination link goes away.
  await expect(page.locator('a[data-sentinel]')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('/home loads older posts when the pagination link scrolls into view', async ({ page }) => {
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const maxId = u.searchParams.get('max_id')
    const body = maxId === null
      ? [makeStatus('c', '<p>newest</p>')]
      : maxId === 'c' ? [makeStatus('b', '<p>older one</p>')]
      : maxId === 'b' ? [makeStatus('a', '<p>oldest</p>')]
      : []
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await gotoSettled(page, '/home')
  // Each short page leaves the link in view; the timeline keeps paging
  // until the server returns an empty page.
  await expect(page.getByText('oldest')).toBeVisible()
  await expect(page.locator('caribou-status-card')).toHaveCount(3)
  await expect(page.locator('caribou-status-card')).toHaveText([/newest/, /older one/, /oldest/])
  await expect(page.locator('a[data-sentinel]')).toHaveCount(0)
})

test('/home surfaces a "new posts" banner when polling finds newer statuses', async ({ page }) => {
  let sawInitial = false
  // The "Older posts →" anchor is initially in view (single short post),
  // so the IntersectionObserver fires `loadMore()` immediately. Return
  // `[]` for `max_id` so the next page is empty and nothing duplicates.
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('max_id')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    const since = u.searchParams.get('since_id')
    if (since === 'a') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([makeStatus('c', '<p>newer post</p>')]),
      })
    }
    sawInitial = true
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([makeStatus('a', '<p>first post</p>')]),
    })
  })
  await gotoSettled(page, '/home')
  await expect(page.getByText('first post')).toBeVisible()
  expect(sawInitial).toBe(true)

  // Force a poll immediately: the poller runs when the tab becomes visible.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')))

  await expect(page.getByRole('button', { name: /1 new post/i })).toBeVisible({ timeout: 5000 })
  // REGRESSION: the existing timeline must stay mounted while the banner is
  // showing — otherwise the "X new posts" button appears alone and the user
  // loses access to the posts they were reading before the poll.
  await expect(page.getByText('first post')).toBeVisible()
  await page.getByRole('button', { name: /1 new post/i }).click()
  await expect(page.getByText('newer post')).toBeVisible()
  // After applying, both the pre-existing post and the newer post should be present.
  await expect(page.getByText('first post')).toBeVisible()
  await expect(page.locator('caribou-status-card')).toHaveText([/newer post/, /first post/])
  await expect(page.getByRole('button', { name: /new post/i })).toHaveCount(0)
})

test('/home does not re-fetch avatar images when polling discovers new posts', async ({ page }) => {
  // When a poll tick surfaces new statuses, the already-displayed status
  // cards must NOT re-render — a replaced <img> makes the browser fetch the
  // avatar again, which flickers the profile pictures and wastes network.
  // This guards against that by counting avatar requests across the poll
  // boundary, and by checking that every <img> node survives.
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('max_id')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    const since = u.searchParams.get('since_id')
    if (since === 'a') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([makeStatus('c', '<p>newer post</p>')]),
      })
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([makeStatus('a', '<p>first post</p>')]),
    })
  })
  const avatarRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().endsWith('/a.png')) avatarRequests.push(req.url())
  })

  await gotoSettled(page, '/home')
  await expect(page.getByText('first post')).toBeVisible()
  const avatars = page.locator('caribou-status-card img')
  await expect(avatars).toHaveCount(1)
  await expect.poll(() => avatarRequests.length).toBeGreaterThan(0)

  const initialFetchCount = avatarRequests.length

  // Tag every avatar node so a replaced node is detectable. The locator
  // crosses the shadow roots (page → timeline → card) for us.
  type Tagged = HTMLImageElement & { __tag?: string }
  await avatars.evaluateAll((imgs) => {
    for (const img of imgs) (img as Tagged).__tag = 'pre-poll'
  })

  // Trigger a poll and wait for the banner to reflect the new post.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('button', { name: /1 new post/i })).toBeVisible({ timeout: 5000 })

  expect(
    avatarRequests.length,
    `expected no additional avatar fetches during a poll that only buffers new posts, got ${avatarRequests.length - initialFetchCount} extra fetch(es)`,
  ).toBe(initialFetchCount)

  // After the poll, every previously-tagged img should still be tagged. A
  // replaced node loses the tag — even a browser-cached src swap flickers.
  const afterPoll = await avatars.evaluateAll((imgs) =>
    imgs.map((img) => (img as Tagged).__tag ?? null))
  expect(afterPoll).toEqual(['pre-poll'])

  // Applying the new post adds a card above; the old card and its avatar
  // node stay, and the shared avatar URL is not requested again.
  await page.getByRole('button', { name: /1 new post/i }).click()
  await expect(page.getByText('newer post')).toBeVisible()
  const afterApply = await avatars.evaluateAll((imgs) =>
    imgs.map((img) => (img as Tagged).__tag ?? null))
  expect(afterApply).toEqual([null, 'pre-poll'])
})

test('/home clears session and redirects on 401', async ({ page }) => {
  // masto's `HttpNativeImpl.createError` throws `MastoUnexpectedError`
  // (no statusCode) when the error response has no Content-Type — so a
  // body-less `{ status: 401 }` never reaches our `normalizeError` 401
  // branch. Return a JSON body so `MastoHttpError` is raised with
  // `statusCode: 401` and `session.onUnauthorized()` actually fires.
  await page.route('**/api/v1/timelines/home*', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unauthorized' }),
    }),
  )
  // `location.replace('/')` fires from the 401 interceptor mid-fetch.
  // Firefox aborts the in-flight /home load (NS_BINDING_ABORTED); webkit
  // samples `page.url()` late. Both make `waitForURL` unreliable across
  // browsers. Instead assert through user-visible state: pathname `/` +
  // the "session expired" alert + cleared localStorage.
  await page.goto('/home', { waitUntil: 'commit' }).catch((e) => {
    if (!String(e).includes('NS_BINDING_ABORTED')) throw e
  })
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  await expect(page.getByRole('alert')).toContainText(/session expired|sign in again/i)
  const ls = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(ls).toBe('null')
})
