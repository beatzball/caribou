import { expect, test, type Page } from '@playwright/test'

const SAMPLE_ACCOUNT = {
  id: 'a1', username: 'beatzball', acct: 'beatzball', display_name: 'Beatz Ball',
  avatar: 'https://fosstodon.org/a.png', avatar_static: 'https://fosstodon.org/a.png',
  url: 'https://fosstodon.org/@beatzball', header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function makeStatus(id: string, content = `<p>post ${id}</p>`) {
  return {
    id, uri: `https://fosstodon.org/@beatzball/${id}`, url: `https://fosstodon.org/@beatzball/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: SAMPLE_ACCOUNT, content,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

// Wait until Litro's morph leaves a single <page-home> behind. The SSR'd
// <page-home> and the client-routed one coexist briefly; while both are
// mounted, each runs `maybeSwapToTimeline`, each fetches, and the same
// post text appears in two parts of the DOM. <main> moved into the
// shell's shadow root in Plan 3, so the prior `querySelectorAll('main')`
// sentinel no longer reflects mount count from the document; count the
// page custom element instead.
async function waitForSingleMount(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('page-home').length === 1)
}

test.beforeEach(async ({ page }) => {
  const session = {
    userKey: 'beatzball@fosstodon.org',
    server: 'fosstodon.org',
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
  await page.goto('/home')
  // Plan 3: signed-out users land on a placeholder that explains the
  // auth requirement instead of a hard redirect to /. Match the visible
  // copy from <caribou-auth-required>.
  await expect(page.getByText(/requires a Mastodon access token/i)).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/home')
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
  await page.goto('/home')
  await waitForSingleMount(page)
  // <caribou-status-card> renders into shadow DOM in Plan 3; Playwright
  // pierces open shadow roots from getByText, so the inner <p> content
  // is reachable directly without a shadow-aware selector.
  await expect(page.getByText('hello world')).toBeVisible()
  await expect(page.getByText('second post')).toBeVisible()
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
  await page.goto('/home')
  await waitForSingleMount(page)
  await expect(page.getByText('first post')).toBeVisible()
  expect(sawInitial).toBe(true)

  // Force a poll immediately by dispatching the banner's host visibility transition.
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
})

test('/home does not re-fetch avatar images when polling discovers new posts', async ({ page }) => {
  // When a poll tick surfaces new statuses, the already-displayed status
  // cards must NOT re-render — otherwise Elena's template creates new <img>
  // elements and the browser re-fetches every avatar, which flickers the
  // profile pictures and wastes network. This guards against that by
  // counting avatar requests across the poll boundary.
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
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([makeStatus('a', '<p>first post</p>')]),
    })
  })
  const avatarRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().endsWith('/a.png')) avatarRequests.push(req.url())
  })

  await page.goto('/home')
  await waitForSingleMount(page)
  await expect(page.getByText('first post')).toBeVisible()

  const initialFetchCount = avatarRequests.length

  // Tag every avatar image so we can detect ANY card re-render. The card
  // renders into shadow DOM, so the avatar lives in `card.shadowRoot`,
  // not light DOM. querySelector('caribou-status-card img') would never
  // see it; reach in via shadowRoot.
  const taggedCount = await page.evaluate(() => {
    const cards = document.querySelectorAll<HTMLElement>('caribou-status-card')
    let tagged = 0
    cards.forEach((card) => {
      const img = card.shadowRoot?.querySelector<HTMLImageElement>('img')
      if (img) {
        (img as HTMLImageElement & { __tag?: string }).__tag = 'pre-poll'
        tagged++
      }
    })
    return tagged
  })
  expect(taggedCount).toBeGreaterThan(0)

  // Trigger a poll and wait for the banner to reflect the new post.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('button', { name: /1 new post/i })).toBeVisible({ timeout: 5000 })

  expect(
    avatarRequests.length,
    `expected no additional avatar fetches during a poll that only buffers new posts, got ${avatarRequests.length - initialFetchCount} extra fetch(es)`,
  ).toBe(initialFetchCount)

  // After the poll, every previously-tagged img should still be tagged. If
  // any was replaced (Elena re-rendered the card), the tag is lost — even a
  // browser-cached src swap produces visible flicker.
  const taggedAfter = await page.evaluate(() => {
    const cards = document.querySelectorAll<HTMLElement>('caribou-status-card')
    let tagged = 0
    let untagged = 0
    let total = 0
    cards.forEach((card) => {
      const img = card.shadowRoot?.querySelector<HTMLImageElement>('img')
      if (!img) return
      total++
      if ((img as HTMLImageElement & { __tag?: string }).__tag === 'pre-poll') tagged++
      else untagged++
    })
    return { total, tagged, untagged }
  })
  expect(taggedAfter.untagged, `expected zero replaced avatar nodes after poll, got ${taggedAfter.untagged}/${taggedAfter.total}`).toBe(0)
})

test('/home clears session and redirects on 401', async ({ page }) => {
  // masto 7.10.2's `HttpNativeImpl.createError` throws `MastoUnexpectedError`
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
  // `location.replace('/?error=unauthorized')` fires from the 401
  // interceptor mid-fetch. Firefox aborts the in-flight /home load
  // (NS_BINDING_ABORTED); webkit samples `page.url()` after the
  // banner's 250ms-post-`load` cleanup (query already stripped). Both
  // make `waitForURL(?error=unauthorized)` unreliable across browsers.
  // Instead assert through user-visible state: pathname `/` + the
  // "session expired" alert (proof the banner saw `?error=unauthorized`
  // before stripping it) + cleared localStorage.
  await page.goto('/home', { waitUntil: 'commit' }).catch((e) => {
    if (!String(e).includes('NS_BINDING_ABORTED')) throw e
  })
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  await expect(page.getByRole('alert')).toContainText(/session expired|sign in again/i)
  const ls = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(ls).toBe('null')
})
