import { expect, test, type Page } from './_fixtures'

// Runs in the `mobile-webkit` project only (iPhone 15). The slow phone
// network of #95: once /home has been seen, tapping back to it shows its
// posts at once even while every request for it hangs.

const INSTANCE = 'example.social'
const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: '', avatar_static: '', url: `https://${INSTANCE}/@alice`,
  header: '', header_static: '', note: '', followers_count: 0, following_count: 0,
  statuses_count: 1, locked: false, bot: false, discoverable: true,
  created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}
const status = (id: string) => ({
  id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
  created_at: '2024-01-01T00:00:00.000Z', account: ACCOUNT, content: `<p>post ${id}</p>`,
  visibility: 'public', sensitive: false, spoiler_text: '',
  media_attachments: [], mentions: [], tags: [], emojis: [],
  reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
})

const shown = (page: Page) => page.locator('litro-outlet > :not([hidden])')
const item = (page: Page, href: string) => shown(page).locator(`caribou-nav-rail a[href="${href}"]`)

test('tapping back to /home paints the cached posts while the network hangs', async ({ page }) => {
  await page.addInitScript((account) => {
    const key = 'alice@example.social'
    localStorage.setItem('caribou.users', JSON.stringify([[key,
      { userKey: key, server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
  }, ACCOUNT)
  let hang = false
  const never = new Promise<void>(() => {})
  await page.route('**/api/v1/timelines/home*', async (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('max_id')) return route.fulfill({ json: [] })
    if (hang) await never
    return route.fulfill({ json: [status('2'), status('1')] })
  })
  await page.route((url) => url.pathname === '/home', async (route) => {
    if (hang && route.request().headers()['accept'] === 'application/json') await never
    await route.continue()
  })

  await page.goto('/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(shown(page).locator('caribou-status-card')).toHaveCount(2)
  await item(page, '/local').tap()
  await expect(page.locator('litro-outlet > page-local:not([hidden])')).toHaveCount(1)

  hang = true
  await item(page, '/home').tap()
  await expect(page.locator('litro-outlet > page-home:not([hidden])')).toHaveCount(1, { timeout: 1000 })
  await expect(shown(page).locator('caribou-status-card').first()).toContainText('post 2')
  await expect(item(page, '/home')).toHaveAttribute('aria-current', 'page')
})
