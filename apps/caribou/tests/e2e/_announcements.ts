import { expect, test, type Page } from './_fixtures.js'
import { installFixtureAuth, loopbackOrigin, waitForSignedInHome } from './_bluesky-auth.js'

const account = {
  id: 'alice', username: 'alice', acct: 'alice', display_name: 'Alice',
  avatar: '', avatar_static: '', header: '', header_static: '', note: '',
  url: 'https://example.social/@alice', followers_count: 0, following_count: 0,
  statuses_count: 0, locked: false, bot: false, discoverable: true,
  created_at: '2026-01-01T00:00:00.000Z', fields: [], emojis: [],
}
const status = (id: string) => ({
  id, uri: `https://example.social/@alice/${id}`, url: `https://example.social/@alice/${id}`,
  created_at: '2026-01-01T00:00:00.000Z', account, content: `<p>Post ${id}</p>`,
  visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [],
  mentions: [], tags: [], emojis: [], reblogs_count: 0, favourites_count: 0,
  replies_count: 0, favourited: false, reblogged: false, bookmarked: false,
})

async function mastodonSession(page: Page) {
  await page.addInitScript((account) => {
    const userKey = 'alice@example.social'
    const session = {
      userKey, server: 'example.social', token: 'TOKEN', generation: 'G',
      vapidKey: '', account, createdAt: 1,
    }
    localStorage.setItem('caribou.users', JSON.stringify([[userKey, session]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(userKey))
  }, account)
}

export function announcementTests() {
  for (const theme of ['light', 'dark'] as const) {
    test(`background polling announces changed availability without taking focus (${theme}, Mastodon)`, async ({ page }) => {
      await mastodonSession(page)
      let next = '2'
      await page.route('**/api/v1/timelines/home*', (route) => {
        const url = new URL(route.request().url())
        return route.fulfill({ json: url.searchParams.has('max_id') ? []
          : url.searchParams.has('since_id') ? [status(next)] : [status('1')] })
      })
      await page.goto('/home')
      await page.locator('litro-outlet[data-litro-settled]').waitFor()
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
      const timeline = page.locator('caribou-timeline')
      const region = timeline.locator('caribou-new-posts-banner [role="status"]')
      await expect(region).toHaveCount(1)
      await expect(region).toHaveText('')
      await expect(region).toHaveAttribute('aria-live', 'polite')
      const reader = timeline.locator('caribou-status-card .author').first()
      await reader.focus()
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await expect(region).toHaveText('1 new post available.')
      await expect(reader).toBeFocused()
      await expect(timeline.getByRole('button', { name: '1 new post', exact: true })).toBeVisible()
      next = '3'
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await expect(region).toHaveText('2 new posts available.')
      await expect(reader).toBeFocused()
      await region.evaluate((el) => {
        const state = { mutations: 0, observer: new MutationObserver(() => { state.mutations++ }) }
        state.observer.observe(el, { childList: true, subtree: true, characterData: true })
        ;(el as Element & { announcementTest?: typeof state }).announcementTest = state
      })
      const poll = page.waitForResponse((response) => response.url().includes('since_id='))
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await poll
      // Let the fulfilled poll reach the signal and Lit update queues.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      expect(await region.evaluate((el) => {
        const state = (el as Element & { announcementTest?: { mutations: number; observer: MutationObserver } }).announcementTest!
        state.observer.disconnect()
        return state.mutations
      })).toBe(0)
      await expect(reader).toBeFocused()
    })

    for (const network of ['Mastodon', 'Bluesky'] as const) {
      test(`filter loading and empty results keep one polite region and filter focus (${theme}, ${network})`, async ({ page, baseURL, browserName }) => {
        test.skip(network === 'Bluesky' && browserName === 'webkit' && process.platform === 'darwin',
          'Playwright WebKit on macOS cannot store the fixture DPoP key in IndexedDB')
        if (network === 'Mastodon') {
          await mastodonSession(page)
          await page.goto('/notifications')
        } else {
          const origin = loopbackOrigin(baseURL)
          await installFixtureAuth(page, { xrpc: (method) => {
            if (method === 'app.bsky.notification.listNotifications') return { body: { notifications: [] } }
            if (method === 'app.bsky.notification.getUnreadCount') return { body: { count: 0 } }
            return undefined
          } })
          await page.goto(`${origin}/`)
          await page.locator('litro-outlet[data-litro-settled]').waitFor()
          await page.getByRole('tab', { name: 'Bluesky' }).click()
          await page.getByLabel('Bluesky handle').fill('alice.example.com')
          await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
          await waitForSignedInHome(page, origin)
          await page.goto(`${origin}/notifications`)
        }
        await page.locator('litro-outlet[data-litro-settled]').waitFor()
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
        const list = page.locator('caribou-notifications')
        const region = list.locator('[role="status"]')
        await expect(region).toHaveText('No notifications yet.')
        await region.evaluate((el) => el.setAttribute('data-original', ''))
        let release!: () => void
        const pending = new Promise<void>((resolve) => { release = resolve })
        await page.route(network === 'Mastodon' ? '**/api/v1/notifications*' : '**/xrpc/app.bsky.notification.listNotifications*', async (route) => {
          if (route.request().method() !== 'GET') return route.fallback()
          await pending
          return route.fulfill({ json: network === 'Mastodon' ? [] : { notifications: [] },
            headers: { 'access-control-allow-origin': '*' } })
        })
        const mentions = list.getByRole('button', { name: 'Mentions', exact: true })
        await mentions.focus()
        await page.keyboard.press('Enter')
        await expect(region).toHaveText('Loading notifications…')
        await expect(region).toHaveAttribute('aria-live', 'polite')
        await expect(mentions).toBeFocused()
        release()
        await expect(region).toHaveText('No mentions yet.')
        await expect(region).toHaveAttribute('data-original', '')
        await expect(region).toHaveAttribute('aria-atomic', 'true')
        await expect(mentions).toBeFocused()
      })
    }
  }
}
