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

function makeStatus(id: string, over: Record<string, unknown> = {}) {
  return {
    id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: SAMPLE_ACCOUNT, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 2, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
    ...over,
  }
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body: unknown, status = 200) =>
  ({ status, contentType: 'application/json', body: JSON.stringify(body) })

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    // The 500 test makes the browser log the failed request itself.
    if (m.type() === 'error' && !/status of 500/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test.beforeEach(async ({ page }) => {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: SAMPLE_ACCOUNT, createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
  await page.route('**/a.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('since_id') || u.searchParams.get('max_id')) return route.fulfill(json([]))
    return route.fulfill(json([makeStatus('a')]))
  })
})

test('favourite then unfavourite on /home updates the count', async ({ page }) => {
  const calls: string[] = []
  // Every server count differs from the optimistic one before it, so the
  // test can tell when each response has been applied: 2, then optimistic
  // 3, server 5, then optimistic 4, server 1.
  await page.route('**/api/v1/statuses/a/favourite', (route) => {
    calls.push('favourite')
    return route.fulfill(json(makeStatus('a', { favourited: true, favourites_count: 5 })))
  })
  await page.route('**/api/v1/statuses/a/unfavourite', (route) => {
    calls.push('unfavourite')
    return route.fulfill(json(makeStatus('a', { favourited: false, favourites_count: 1 })))
  })
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')

  const fav = page.getByRole('button', { name: 'Favourite', exact: true })
  // Signed out it is soft-disabled (`aria-disabled`), which Playwright
  // counts as disabled.
  await expect(fav).toBeEnabled()
  await expect(fav).toHaveAttribute('aria-pressed', 'false')
  await expect(fav).toHaveText('2')

  await fav.click()
  const unfav = page.getByRole('button', { name: 'Unfavourite' })
  await expect(unfav).toHaveAttribute('aria-pressed', 'true')
  // Wait for the server's count, not just the request: a click while the
  // first write is still in flight is dropped by design (the in-flight
  // guard in caribou-state's mutations).
  await expect(unfav).toHaveText('5')
  expect(calls).toEqual(['favourite'])

  await unfav.click()
  await expect(fav).toHaveAttribute('aria-pressed', 'false')
  await expect(fav).toHaveText('1')
  expect(calls).toEqual(['favourite', 'unfavourite'])
  expect(errors).toEqual([])
})

test('a 500 rolls the favourite back and shows an error toast', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/api/v1/statuses/a/favourite', async (route) => {
    await held
    return route.fulfill(json({ error: 'boom' }, 500))
  })
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')

  const fav = page.getByRole('button', { name: 'Favourite', exact: true })
  await fav.click()
  // Optimistic: the bar flips before the server answers.
  const unfav = page.getByRole('button', { name: 'Unfavourite' })
  await expect(unfav).toHaveAttribute('aria-pressed', 'true')
  await expect(unfav).toHaveText('3')
  release()

  await expect(fav).toHaveAttribute('aria-pressed', 'false')
  await expect(fav).toHaveText('2')
  const alert = page.locator('caribou-toaster').getByRole('alert')
  await expect(alert).toContainText('Could not favourite this post.')
  await alert.getByRole('button', { name: 'Dismiss' }).click()
  await expect(alert).toHaveCount(0)
  expect(errors).toEqual([])
})
