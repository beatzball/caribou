import { expect, test, type Page } from '@playwright/test'

const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: 'https://example.social/a.png', avatar_static: 'https://example.social/a.png',
  url: 'https://example.social/@alice', header: '', header_static: '', note: '<p>bio of alice</p>',
  followers_count: 3, following_count: 2, statuses_count: 7, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function makeStatus(id: string, content = `<p>post ${id}</p>`) {
  return {
    id, uri: `https://example.social/@alice/${id}`, url: `https://example.social/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: ACCOUNT, content,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

// The router hydrates the server-rendered page, builds a second one, then
// swaps them. Until the swap, the visible page is not the live one.
async function settled(page: Page) {
  await page.waitForSelector('litro-outlet[data-litro-settled]', { state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

async function signIn(page: Page) {
  await page.addInitScript((account) => {
    const session = {
      userKey: 'alice@example.social', server: 'example.social', token: 'TOKEN',
      vapidKey: '', account, createdAt: 1,
    }
    localStorage.setItem('caribou.users', JSON.stringify([[session.userKey, session]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(session.userKey))
  }, ACCOUNT)
}

// Collects what would show a broken hydration: an uncaught error or a
// console error. Avatar requests to the fake host fail by design.
function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  return errors
}

test.describe('/@me — own profile', () => {
  test('signed out: shows the sign-in placeholder, before and after the router settles', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/@me')
    await expect(page.getByText(/Your profile shows posts from your signed-in account/)).toBeVisible()
    await settled(page)
    await expect(page.getByText(/Your profile shows posts from your signed-in account/)).toBeVisible()
    await expect(page.locator('caribou-profile')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('signed in: loads the profile through the signed-in client', async ({ page }) => {
    const errors = trackErrors(page)
    await signIn(page)
    const lookups: string[] = []
    await page.route('**/api/v1/accounts/lookup*', (route) => {
      lookups.push(new URL(route.request().url()).searchParams.get('acct') ?? '')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ACCOUNT) })
    })
    // The "Older posts" link is in view on a short list, so the next page is
    // requested at once. It must be empty, or the list would grow forever.
    await page.route('**/api/v1/accounts/a1/statuses*', (route) => {
      const u = new URL(route.request().url())
      const body = u.searchParams.get('max_id') ? [] : [makeStatus('s2', '<p>newest post</p>'), makeStatus('s1', '<p>older post</p>')]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.goto('/@me')
    await settled(page)

    await expect(page.getByText('Alice Example').first()).toBeVisible()
    await expect(page.getByText('bio of alice')).toBeVisible()
    await expect(page.getByText('newest post')).toBeVisible()
    await expect(page.getByText('older post')).toBeVisible()
    await expect(page.locator('caribou-profile caribou-status-card')).toHaveCount(2)
    await expect(page.locator('caribou-profile-tabs a[aria-current="page"]')).toHaveText('posts')
    await expect(page.getByText(/Your profile shows posts/)).toHaveCount(0)
    // The last page came back empty, so there is nothing more to link to.
    await expect(page.locator('caribou-profile a[rel="next"]')).toHaveCount(0)
    expect(lookups.every((acct) => acct === 'alice@example.social')).toBe(true)
    expect(errors).toEqual([])
  })

  test('signed in: reads the tab from the address bar', async ({ page }) => {
    await signIn(page)
    await page.route('**/api/v1/accounts/lookup*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ACCOUNT) }))
    const queries: string[] = []
    await page.route('**/api/v1/accounts/a1/statuses*', (route) => {
      const u = new URL(route.request().url())
      queries.push(u.search)
      const body = u.searchParams.get('max_id') ? [] : [makeStatus('m1', '<p>media post</p>')]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.goto('/@me?tab=media')
    await settled(page)
    await expect(page.getByText('media post')).toBeVisible()
    await expect(page.locator('caribou-profile-tabs a[aria-current="page"]')).toHaveText('media')
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.every((q) => q.includes('only_media=true'))).toBe(true)
  })
})

test.describe('/@handle — states that need no upstream', () => {
  test('bare handle with no instance: shows the instance placeholder', async ({ page }) => {
    await page.goto('/@alice')
    await settled(page)
    await expect(page.getByText(/Profiles by bare handle/)).toBeVisible()
  })

  // `.invalid` never resolves, so the lookup fails without leaving the machine.
  test('lookup failure: shows an alert that names the handle', async ({ page }) => {
    await page.goto('/@nobody@example.invalid')
    await settled(page)
    await expect(page.getByRole('alert')).toHaveText("Couldn't load profile @nobody@example.invalid.")
  })
})

// These hit the real fosstodon.org through the server's pageData fetch; no
// browser-level interception can reach a request made in the nitro process.
// Skipped in CI so a build does not depend on upstream uptime.
test.describe('/@handle — server-rendered profile (real upstream)', () => {
  test.skip(!!process.env.CI, 'Hits real upstream; skip in CI')

  // A stable public account on fosstodon.org (the instance admin).
  const PROFILE = '/@kev@fosstodon.org'

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    test('renders the header, the tabs and the cards', async ({ page }) => {
      await page.goto(PROFILE)
      await expect(page.locator('caribou-profile-header .handle')).toHaveText('@kev')
      await expect(page.locator('caribou-profile-header .counts')).toContainText(/\d+\s+Posts/)
      await expect(page.locator('caribou-profile-tabs a')).toHaveText(['posts', 'replies', 'media'])
      expect(await page.locator('caribou-profile caribou-status-card').count()).toBeGreaterThan(0)
      await expect(page.locator('caribou-profile caribou-status-card .status-content').first()).toBeVisible()
      await expect(page.getByText('Loading…')).toHaveCount(0)
    })

    test('"Older posts" is a link to the next page', async ({ page }) => {
      await page.goto(PROFILE)
      const next = page.locator('caribou-profile a[rel="next"][data-sentinel]')
      await expect(next).toBeVisible()
      expect(await next.getAttribute('href')).toMatch(/\?tab=posts&max_id=\d+$/)
    })
  })

  test('hydrates without an error and keeps the server-rendered cards', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto(PROFILE)
    const firstId = await page.locator('caribou-profile caribou-status-card').first().getAttribute('data-status-id')
    await settled(page)
    await expect(page.locator('caribou-profile-header .handle')).toHaveText('@kev')
    await expect(page.locator('caribou-profile caribou-status-card').first()).toHaveAttribute('data-status-id', firstId!)
    expect(await page.locator('caribou-profile caribou-status-card').count()).toBeGreaterThan(0)
    await expect(page.getByText('Loading…')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
