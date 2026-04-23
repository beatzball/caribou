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
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
})

test('/home without activeUserKey redirects to /', async ({ page, context }) => {
  // Clear the script from beforeEach for this one test.
  await context.clearCookies()
  await page.addInitScript(() => {
    localStorage.removeItem('caribou.users')
    localStorage.removeItem('caribou.activeUserKey')
  })
  await page.goto('/home')
  await page.waitForURL((url) => url.pathname === '/')
  expect(new URL(page.url()).pathname).toBe('/')
})

test('/home with activeUserKey renders timeline statuses from the fake Mastodon API', async ({ page }) => {
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const since = u.searchParams.get('since_id')
    if (since) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([makeStatus('a', '<p>hello world</p>'), makeStatus('b', '<p>second post</p>')]),
    })
  })
  await page.goto('/home')
  await expect(page.getByText('hello world')).toBeVisible()
  await expect(page.getByText('second post')).toBeVisible()
})

test('/home surfaces a "new posts" banner when polling finds newer statuses', async ({ page }) => {
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
  await page.goto('/home')
  await expect(page.getByText('first post')).toBeVisible()
  expect(sawInitial).toBe(true)

  // Force a poll immediately by dispatching the banner's host visibility transition.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')))

  await expect(page.getByRole('button', { name: /1 new post/i })).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /1 new post/i }).click()
  await expect(page.getByText('newer post')).toBeVisible()
})

test('/home clears session and redirects on 401', async ({ page }) => {
  await page.route('**/api/v1/timelines/home*', (route) =>
    route.fulfill({ status: 401 }),
  )
  await page.goto('/home')
  await page.waitForURL((url) => url.pathname === '/' && url.search.includes('unauthorized'))
  const ls = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(ls).toBe('null')
})
