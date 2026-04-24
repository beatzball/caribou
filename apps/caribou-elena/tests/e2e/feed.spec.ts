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
  await page.goto('/feed')
  // Use `waitUntil: 'commit'` — the `/feed` navigation is aborted by
  // `FeedPage.connectedCallback`'s `location.replace('/')` during the
  // initial load. Firefox surfaces the abort as `NS_BINDING_ABORTED`
  // if we wait on the default `'load'` event. Observing at commit
  // catches the redirect target as soon as the browser commits to it.
  await page.waitForURL((url) => url.pathname === '/', { waitUntil: 'commit' })
  expect(new URL(page.url()).pathname).toBe('/')
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

  // Force a poll immediately by dispatching the banner's host visibility transition.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')))

  await expect(mainVisible.getByRole('button', { name: /1 new post/i })).toBeVisible({ timeout: 5000 })
  await mainVisible.getByRole('button', { name: /1 new post/i }).click()
  await expect(mainVisible.getByText('newer post')).toBeVisible()
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
  await page.goto('/feed')
  // `caribou-error-banner` strips the `error=` query param 250ms after
  // `load` via `history.replaceState`. On webkit, Playwright's frame
  // URL sampling can land *after* that cleanup even when we ask for
  // `domcontentloaded` — the observed URL is then `/` (query already
  // gone) and the predicate misses. Use `waitUntil: 'commit'` so the
  // URL is checked at navigation-commit time, before any script runs.
  await page.waitForURL(
    (url) => url.pathname === '/' && url.search.includes('unauthorized'),
    { waitUntil: 'commit' },
  )
  const ls = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(ls).toBe('null')
})
