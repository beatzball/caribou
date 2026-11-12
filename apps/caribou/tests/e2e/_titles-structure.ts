import { expect, test, type Page } from './_fixtures.js'
import { ALICE, API, BOB, gotoSettled, json, relationship, signIn, status } from './_moderation.js'
import { list, serveLists } from './_lists.js'
import { livePage } from './_server-page.js'

const CAMEL_ACCOUNT = {
  id: 'b1', username: 'bob', acct: 'bob', displayName: 'BOB', avatar: '', avatarStatic: '',
  note: '', header: '', headerStatic: '', followersCount: 0, followingCount: 0, statusesCount: 1,
}
const POST = {
  id: '42', uri: 'https://example.social/@bob/42', account: CAMEL_ACCOUNT, content: '<p>A fixture thread</p>',
  createdAt: '2024-01-01T00:00:00.000Z', mediaAttachments: [], mentions: [], tags: [], emojis: [],
}
export async function go(page: Page, path: string, tag: string) {
  await page.evaluate((path) => {
    history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await expect(livePage(page)).toHaveJSProperty('localName', tag)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

export function titleStructureTests() {
  for (const theme of ['dark', 'light']) {
    test.describe(theme, () => {
      test.beforeEach(async ({ page }) => {
        await page.addInitScript((theme) => {
          localStorage.setItem('caribou.prefs.alice@example.social', JSON.stringify({ theme }))
        }, theme)
      })

      test('rule 1: direct document titles describe every route, without JavaScript', async ({ request }) => {
        for (const [path, title] of [
          ['/', 'Welcome'], ['/home', 'Home'], ['/local', 'Local'], ['/public', 'Public'],
          ['/notifications', 'Notifications'], ['/search?q=birds', 'Search: birds'],
          ['/feeds', 'Feeds'], ['/lists', 'Lists'], ['/lists/42', 'List'], ['/bookmarks', 'Bookmarks'],
          ['/@me', 'Profile'], ['/@alice/42', 'Thread'], ['/settings', 'Settings'],
          ['/settings/moderation', 'Moderation settings'], ['/about', 'About'], ['/privacy', 'Privacy'],
          ['/changelog', 'Changelog'], ['/signin/bluesky', 'Sign in with Bluesky'], ['/blog', 'Blog'],
          ['/blog/hello-world', 'Post: hello-world'], ['/tags/Caf%C3%A9', '#Café'],
        ]) {
          const response = await request.get(path!)
          expect(await response.text(), path).toContain(`<title>${title} · Caribou</title>`)
        }
        const escaped = await (await request.get('/search?q=%3C%2Ftitle%3E%3Cscript%3E')).text()
        expect(escaped).toContain('<title>Search: &lt;/title&gt;&lt;script&gt; · Caribou</title>')
      })

      test('rules 1 and 2: SPA, Back and Forward keep titles and one useful announcement', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await gotoSettled(page, '/about')
        await expect(page).toHaveTitle('About · Caribou')
        await page.evaluate(() => { (window as unknown as { spa: boolean }).spa = true })
        for (const [path, tag, title] of [
          ['/settings', 'page-settings', 'Settings'],
          ['/notifications', 'page-notifications', 'Notifications'],
          ['/search?q=birds', 'page-search', 'Search: birds'],
          ['/tags/Caf%C3%A9', 'page-tags-tag', '#Café'],
          ['/privacy', 'page-privacy', 'Privacy'],
          ['/changelog', 'page-changelog', 'Changelog'],
          ['/signin/bluesky', 'page-signin-bluesky', 'Sign in with Bluesky'],
          ['/blog', 'page-blog', 'Blog'], ['/blog/hello-world', 'page-blog-slug', 'Post: hello-world'],
        ]) {
          await go(page, path!, tag!)
          await expect(page).toHaveTitle(`${title} · Caribou`)
          if (path === '/settings' || path === '/notifications') {
            await expect(page.locator('#_litro_announce')).toHaveText(`${title} · Caribou`)
          }
        }
        await page.goBack()
        await expect(page).toHaveTitle('Blog · Caribou')
        await page.goForward()
        await expect(page).toHaveTitle('Post: hello-world · Caribou')
        expect(await page.evaluate(() => (window as unknown as { spa: boolean }).spa)).toBe(true)
        expect(errors).toEqual([])
      })

      for (const signedIn of [false, true]) {
        test(`rule 4: ${signedIn ? 'signed-in' : 'signed-out'} rail has supporting and Search landmarks only on desktop`, async ({ page, isMobile }) => {
          if (signedIn) await signIn(page)
          await gotoSettled(page, '/about')
          if (!signedIn) await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), theme)
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
          if (isMobile) {
            await expect(page.getByRole('complementary', { name: 'Supporting information' })).toHaveCount(0)
            await expect(page.getByRole('search', { name: 'Search' })).toHaveCount(0)
          } else {
            const rail = page.getByRole('complementary', { name: 'Supporting information' })
            await expect(rail).toHaveCount(1)
            await expect(rail.getByRole('link', { name: 'Keyboard shortcuts' })).toBeVisible()
            await expect(rail).toContainText('Caribou')
            await expect(page.getByRole('search', { name: 'Search' })).toHaveCount(1)
          }
        })
      }

      test('rule 2: a delayed list name cannot overwrite Settings after leaving', async ({ page }) => {
        await signIn(page)
        let release!: () => void
        const held = new Promise<void>((resolve) => { release = resolve })
        let requested = false
        await page.route(`${API}/v1/lists/42`, async (route) => {
          requested = true
          await held
          await route.fulfill(json(list('42', 'Late list name')))
        })
        await page.route(`${API}/v1/timelines/list/42*`, (route) => route.fulfill(json([])))
        await gotoSettled(page, '/lists/42')
        await expect.poll(() => requested).toBe(true)
        await go(page, '/settings', 'page-settings')
        await expect(page).toHaveTitle('Settings · Caribou')
        const response = page.waitForResponse(`${API}/v1/lists/42`)
        release()
        await (await response).finished()
        await expect(page.locator('#_litro_announce')).toHaveText('Settings · Caribou')
        await expect(page).toHaveTitle('Settings · Caribou')
      })

      test('rules 1 to 3: populated reading routes have one heading and dynamic names survive history', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await signIn(page)
        await page.route(`${API}/v1/accounts/relationships*`, (route) => route.fulfill(json([relationship('b1')])))
        await page.route(`${API}/v1/accounts/lookup*`, (route) => route.fulfill(json(ALICE)))
        await page.route(`${API}/v1/accounts/a1/statuses*`, (route) => route.fulfill(json([])))
        await page.route(`${API}/v1/timelines/**`, (route) => {
          const query = new URL(route.request().url()).searchParams
          return route.fulfill(json(query.has('max_id') || query.has('since_id') ? [] : [status('1', BOB)]))
        })
        await page.route(`${API}/v1/statuses?*`, (route) => route.fulfill(json([status('42', BOB)])))
        await page.route(`${API}/v1/statuses/42`, (route) => route.fulfill(json(status('42', BOB))))
        await page.route(`${API}/v1/bookmarks*`, (route) => route.fulfill(json([status('1', BOB)])))
        await serveLists(page, [list('42', 'Birdwatching')])
        await page.route((url) => ['/local', '/public', '/@bob', '/@bob/42'].includes(url.pathname), (route) => {
          if (!route.request().headers()['accept']?.includes('application/json')) return route.continue()
          const path = new URL(route.request().url()).pathname
          const data = path === '/@bob'
            ? { account: CAMEL_ACCOUNT, statuses: [], nextCursor: null, tab: 'posts', handle: 'bob' }
            : path === '/@bob/42'
            ? { focused: POST, ancestors: [], descendants: [], handle: 'bob', statusId: '42' }
            : { statuses: [POST], nextCursor: null }
          return route.fulfill(json({ ...data, kind: 'ok', shell: { instance: 'example.social' } }))
        })
        await gotoSettled(page, '/home')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(livePage(page).locator('caribou-status-card')).toHaveCount(1)
        for (const [path, tag, heading, title] of [
          ['/home', 'page-home', 'Home', 'Home'], ['/local', 'page-local', 'Local', 'Local'],
          ['/public', 'page-public', 'Public', 'Public'], ['/bookmarks', 'page-bookmarks', 'Bookmarks', 'Bookmarks'],
          ['/@me', 'page-handle', 'ALICE', 'ALICE'], ['/@bob', 'page-handle', 'BOB', 'BOB'],
          ['/@bob/42', 'page-handle-statusid', 'Thread', 'Thread by BOB'],
          ['/lists/42', 'page-lists-id', 'Birdwatching', 'Birdwatching'],
        ]) {
          await go(page, path!, tag!)
          await expect(livePage(page).getByRole('heading', { level: 1, name: heading, exact: true })).toHaveCount(1)
          await expect(livePage(page).getByRole('heading', { level: 1 })).toHaveCount(1)
          await expect(page).toHaveTitle(`${title} · Caribou`)
        }
        await page.goBack()
        await expect(page).toHaveTitle('Thread by BOB · Caribou')
        await page.goForward()
        await expect(page).toHaveTitle('Birdwatching · Caribou')
        await go(page, '/settings', 'page-settings')
        await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toHaveCount(0)
        await expect(page).toHaveTitle('Settings · Caribou')
        expect(errors).toEqual([])
      })
    })
  }
}
