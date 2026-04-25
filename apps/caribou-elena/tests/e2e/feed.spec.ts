import { expect, test } from '@playwright/test'

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

test('/feed without activeUserKey redirects to /', async ({ page, context }) => {
  // Clear the script from beforeEach for this one test.
  await context.clearCookies()
  await page.addInitScript(() => {
    localStorage.removeItem('caribou.users')
    localStorage.removeItem('caribou.activeUserKey')
  })
  // `FeedPage.connectedCallback` triggers `location.replace('/')`
  // synchronously during /feed's load — firefox reports the aborted
  // /feed load as `NS_BINDING_ABORTED`, which surfaces from both
  // `goto` and `waitForURL`. Use `waitUntil: 'commit'` on goto and
  // swallow the abort: the abort *is* the redirect firing.
  await page.goto('/feed', { waitUntil: 'commit' }).catch((e) => {
    if (!String(e).includes('NS_BINDING_ABORTED')) throw e
  })
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
})

test('/feed with activeUserKey renders timeline statuses from the fake Mastodon API', async ({ page }) => {
  // Note: `/api/v1/timelines/home` is the Mastodon API endpoint for the
  // "home" timeline type — unrelated to our page route. Do not rename it.
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const since = u.searchParams.get('since_id')
    if (since) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([makeStatus('a', '<p>hello world</p>'), makeStatus('b', '<p>second post</p>')]),
    })
  })
  await page.goto('/feed')
  // During the first client-side navigation, Litro's router appends the
  // newly-routed <page-feed> alongside the SSR-rendered one (the former
  // is hidden until the inner components finish their first render, then
  // the SSR element is removed). Both elements run Elena's custom-element
  // lifecycle, so both fetch and both render the timeline — meaning the
  // same post text briefly appears in TWO parts of the DOM. Scope text
  // assertions to the currently-visible <main> to avoid strict-mode
  // collisions on that transient duplicate.
  const mainVisible = page.locator('main').filter({ visible: true }).first()
  await expect(mainVisible.getByText('hello world')).toBeVisible()
  await expect(mainVisible.getByText('second post')).toBeVisible()
})

test('/feed surfaces a "new posts" banner when polling finds newer statuses', async ({ page }) => {
  let sawInitial = false
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
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
  await page.goto('/feed')
  // Scope to the visible <main> — see comment in the previous test about
  // Litro's double-mount during initial hydration.
  const mainVisible = page.locator('main').filter({ visible: true }).first()
  await expect(mainVisible.getByText('first post')).toBeVisible()
  expect(sawInitial).toBe(true)

  // Wait for Litro's SSR-mount cleanup before dispatching the visibility
  // event. During the brief window when both the SSR and client
  // <page-feed> coexist, the dispatch can be processed by the SSR mount's
  // polling listener — which is about to be torn down — while the client
  // mount's `connectedCallback` hasn't yet attached its own listener. The
  // poll then never reaches the surviving timeline, the banner stays at
  // count=0, and this assertion times out. (Test was 1/39 flaky on
  // chromium in CI before this guard.)
  await page.waitForFunction(() => document.querySelectorAll('main').length === 1)

  // Force a poll immediately by dispatching the banner's host visibility transition.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')))

  await expect(mainVisible.getByRole('button', { name: /1 new post/i })).toBeVisible({ timeout: 5000 })
  // REGRESSION: the existing timeline must stay mounted while the banner is
  // showing — otherwise the "X new posts" button appears alone and the user
  // loses access to the posts they were reading before the poll.
  await expect(mainVisible.getByText('first post')).toBeVisible()
  await mainVisible.getByRole('button', { name: /1 new post/i }).click()
  await expect(mainVisible.getByText('newer post')).toBeVisible()
  // After applying, both the pre-existing post and the newer post should be
  // present.
  await expect(mainVisible.getByText('first post')).toBeVisible()
})

test('/feed does not re-fetch avatar images when polling discovers new posts', async ({ page }) => {
  // When a poll tick surfaces new statuses, the already-displayed status
  // cards must NOT re-render — otherwise Elena's template creates new <img>
  // elements and the browser re-fetches every avatar, which flickers the
  // profile pictures and wastes network. This guards against that by
  // counting avatar requests across the poll boundary.
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
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

  await page.goto('/feed')
  const mainVisible = page.locator('main').filter({ visible: true }).first()
  await expect(mainVisible.getByText('first post')).toBeVisible()

  // Wait for Litro's SSR-mount cleanup so we're not tagging an element on a
  // <main> that's about to be removed.
  await page.waitForFunction(() => document.querySelectorAll('main').length === 1)

  const initialFetchCount = avatarRequests.length

  // Tag every avatar image so we can detect ANY card re-render.
  const taggedCount = await page.evaluate(() => {
    const imgs = document.querySelectorAll<HTMLImageElement>('caribou-status-card img')
    imgs.forEach((img) => { (img as HTMLImageElement & { __tag?: string }).__tag = 'pre-poll' })
    return imgs.length
  })
  expect(taggedCount).toBeGreaterThan(0)

  // Trigger a poll and wait for the banner to reflect the new post.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')))
  await expect(mainVisible.getByRole('button', { name: /1 new post/i })).toBeVisible({ timeout: 5000 })

  expect(
    avatarRequests.length,
    `expected no additional avatar fetches during a poll that only buffers new posts, got ${avatarRequests.length - initialFetchCount} extra fetch(es)`,
  ).toBe(initialFetchCount)

  // After the poll, every previously-tagged img should still be tagged. If
  // any was replaced (Elena re-rendered the card), the tag is lost — even a
  // browser-cached src swap produces visible flicker.
  const taggedAfter = await page.evaluate(() => {
    const imgs = document.querySelectorAll<HTMLImageElement>('caribou-status-card img')
    let tagged = 0
    let untagged = 0
    imgs.forEach((img) => {
      if ((img as HTMLImageElement & { __tag?: string }).__tag === 'pre-poll') tagged++
      else untagged++
    })
    return { total: imgs.length, tagged, untagged }
  })
  expect(taggedAfter.untagged, `expected zero replaced avatar nodes after poll, got ${taggedAfter.untagged}/${taggedAfter.total}`).toBe(0)
})

test('/feed clears session and redirects on 401', async ({ page }) => {
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
  // interceptor mid-fetch. Firefox aborts the in-flight /feed load
  // (NS_BINDING_ABORTED); webkit samples `page.url()` after the
  // banner's 250ms-post-`load` cleanup (query already stripped). Both
  // make `waitForURL(?error=unauthorized)` unreliable across browsers.
  // Instead assert through user-visible state: pathname `/` + the
  // "session expired" alert (proof the banner saw `?error=unauthorized`
  // before stripping it) + cleared localStorage.
  await page.goto('/feed', { waitUntil: 'commit' }).catch((e) => {
    if (!String(e).includes('NS_BINDING_ABORTED')) throw e
  })
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  await expect(page.getByRole('alert')).toContainText(/session expired|sign in again/i)
  const ls = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(ls).toBe('null')
})
