import { expect, test, type Page } from './_fixtures.js'

// Keyboard shortcuts (#53) on a phone: a tap is not a key, so nothing
// changes. Only key presses start a shortcut (`components/_shortcuts.ts`).

const INSTANCE = 'example.social'
const BOB = {
  id: 'b1', username: 'bob', acct: 'bob', display_name: 'Bob Example',
  avatar: `https://${INSTANCE}/a.png`, avatar_static: `https://${INSTANCE}/a.png`,
  url: `https://${INSTANCE}/@bob`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}
const status = (id: string) => ({
  id, uri: `https://${INSTANCE}/@bob/${id}`, url: `https://${INSTANCE}/@bob/${id}`,
  created_at: '2024-01-01T00:00:00.000Z', account: BOB, content: `<p>post ${id}</p>`,
  visibility: 'public', sensitive: false, spoiler_text: '',
  media_attachments: [], mentions: [], tags: [], emojis: [],
  reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
})

async function seed(page: Page) {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: { ...BOB, id: 'a1', username: 'alice', acct: 'alice' }, createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
  await page.route('**/a.png', (route) => route.fulfill({ status: 404 }))
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('since_id') || u.searchParams.get('max_id')) return route.fulfill({ json: [] })
    return route.fulfill({ json: [status('1'), status('2')] })
  })
}

test('a tap on a post does not focus, name or mark it', async ({ page }) => {
  await seed(page)
  await page.goto('/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  const items = page.locator('caribou-timeline li')
  await expect(items).toHaveCount(2)
  await page.getByText('post 2').tap()
  await expect(items.nth(1)).not.toBeFocused()
  for (let i = 0; i < 2; i++) {
    await expect(items.nth(i)).not.toHaveAttribute('data-caribou-post')
    await expect(items.nth(i)).not.toHaveAttribute('aria-label')
    await expect(items.nth(i)).not.toHaveAttribute('tabindex')
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/home$/)
})
