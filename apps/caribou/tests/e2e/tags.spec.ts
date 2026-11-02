import { expect, test, type BrowserContext, type Page } from './_fixtures.js'

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

const ALICE = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: AVATAR, avatar_static: AVATAR, url: `https://${INSTANCE}/@alice`,
  header: '', header_static: '', note: '', followers_count: 0, following_count: 0,
  statuses_count: 1, locked: false, bot: false, discoverable: true,
  created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

const POST = {
  id: 's1', uri: `https://${INSTANCE}/@alice/s1`, url: `https://${INSTANCE}/@alice/s1`,
  created_at: '2024-01-01T00:00:00.000Z', account: ALICE,
  content: `<p>a post <a href="https://${INSTANCE}/tags/AI" class="mention hashtag" rel="tag">#<span>AI</span></a></p>`,
  visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], emojis: [],
  mentions: [], tags: [{ name: 'ai', url: `https://${INSTANCE}/tags/ai` }],
  reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const tag = (following: boolean) => ({ id: 't1', name: 'ai', url: `https://${INSTANCE}/tags/ai`, history: [], following })

async function settled(page: Page) {
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

async function signIn(page: Page) {
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, { userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '', account: ALICE, createdAt: 1 })
  await page.route('**/a.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
}

test.describe('signed out', () => {
  test('the server sends the page with its title and the sign-in placeholder', async ({ request }) => {
    const res = await request.get('/tags/AI')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('<title>#AI · Caribou</title>')
    expect(body).toContain('#AI needs to know which instance to query.')
    expect(body).not.toContain('class="follow"')
  })

  test('a non-ASCII tag is decoded in the title', async ({ page, request }) => {
    // The server's own <title>, not the one the page sets after it loads.
    const body = await (await request.get(`/tags/${encodeURIComponent('日本')}`)).text()
    expect(body).toContain('<title>#日本 · Caribou</title>')
    await page.goto(`/tags/${encodeURIComponent('日本')}`)
    await expect(page).toHaveTitle('#日本 · Caribou')
  })

  test('a name that cannot be a hashtag says so', async ({ page }) => {
    await page.goto('/tags/a-b')
    await settled(page)
    await expect(page.getByText('#a-b is not a hashtag.')).toBeVisible()
  })

  test('shows no follow button', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto('/tags/AI')
    await settled(page)
    await expect(page.getByText('#AI needs to know which instance to query.')).toBeVisible()
    await expect(page.locator('caribou-button.follow')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the page is readable, with a sign-in link', async ({ page }) => {
    await page.goto('/tags/AI')
    await expect(page.getByText('#AI needs to know which instance to query.')).toBeVisible()
    await expect(page.locator('caribou-auth-required').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/')
  })
})

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.route('**/api/v1/timelines/tag/**', (route) =>
      route.fulfill(json(new URL(route.request().url()).searchParams.get('max_id') ? [] : [POST])))
  })

  // With no instance cookie the server sends the placeholder; the cards come
  // from the reader's server after it. tags-ssr.spec.ts hydrates server cards.
  test('swaps the placeholder for the tag timeline from the reader\'s server', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.route('**/api/v1/tags/AI', (route) => route.fulfill(json(tag(false))))
    await page.goto('/tags/AI')
    await settled(page)
    await expect(page.locator('caribou-tag-header h1')).toHaveText('#AI')
    await expect(page.locator('caribou-status-card .status-content')).toContainText('a post')
    await expect(page).toHaveTitle('#AI · Caribou')
    expect(errors).toEqual([])
  })

  test('follow, then unfollow, the tag', async ({ page }) => {
    const writes: string[] = []
    await page.route('**/api/v1/tags/AI', (route) => route.fulfill(json(tag(false))))
    await page.route('**/api/v1/tags/AI/follow', (route) => { writes.push('follow'); return route.fulfill(json(tag(true))) })
    await page.route('**/api/v1/tags/AI/unfollow', (route) => { writes.push('unfollow'); return route.fulfill(json(tag(false))) })
    await page.goto('/tags/AI')
    await settled(page)
    const button = page.locator('caribou-tag-header caribou-button.follow')
    await expect(button).toHaveText('Follow')
    await button.click()
    await expect(button).toHaveAttribute('data-state', 'following')
    await expect.poll(() => writes).toEqual(['follow'])
    await button.click()
    await expect(button).toHaveAttribute('data-state', 'follow')
    await expect.poll(() => writes).toEqual(['follow', 'unfollow'])
  })

  test('a failed follow goes back to Follow and says so', async ({ page }) => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    await page.route('**/api/v1/tags/AI', (route) => route.fulfill(json(tag(false))))
    await page.route('**/api/v1/tags/AI/follow', async (route) => {
      await held
      return route.fulfill(json({ error: 'boom' }, 500))
    })
    await page.goto('/tags/AI')
    await settled(page)
    const button = page.locator('caribou-tag-header caribou-button.follow')
    await button.click()
    // The button changes before the server answers.
    await expect(button).toHaveAttribute('data-state', 'following')
    release()
    await expect(button).toHaveAttribute('data-state', 'follow')
    await expect(page.getByText("Couldn't follow #AI.")).toBeVisible()
  })

  test('the title goes back to Caribou on the next page', async ({ page }) => {
    await page.route('**/api/v1/tags/AI', (route) => route.fulfill(json(tag(false))))
    await page.route('**/api/v1/timelines/home*', (route) => route.fulfill(json([])))
    await page.goto('/tags/AI')
    await settled(page)
    await expect(page).toHaveTitle('#AI · Caribou')
    await page.evaluate(() => {
      history.pushState(null, '', '/home')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect.poll(() => new URL(page.url()).pathname).toBe('/home')
    await expect(page).toHaveTitle('Caribou')
  })
})

// The server reads the tag timeline from a real instance; see
// public-timeline.spec.ts for the storage it needs locally.
test.describe('server render from a real instance', () => {
  test.skip(!!process.env.CI, 'Hits real upstream; skip in CI')

  async function withInstanceCookie(context: BrowserContext) {
    await context.addCookies([{
      name: 'caribou.instance', value: 'fosstodon.org', domain: 'localhost', path: '/',
      httpOnly: true, secure: false, sameSite: 'Lax',
    }])
  }

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    test('paints the heading, the cards and the older-posts link', async ({ page, context }) => {
      await withInstanceCookie(context)
      await page.goto('/tags/caturday')
      await expect(page.locator('caribou-tag-header h1')).toHaveText('#caturday')
      await page.waitForSelector('caribou-status-card', { timeout: 5000 })
      expect(await page.locator('caribou-status-card').count()).toBeGreaterThan(0)
      await expect(page.locator('a[rel="next"][data-sentinel]')).toHaveAttribute('href', /^\?max_id=/)
      // Hashtag links in the posts keep their instance href.
      const tags = page.locator('caribou-status-card .status-content a.hashtag')
      if (await tags.count()) await expect(tags.first()).toHaveAttribute('href', /^https:\/\//)
    })
  })
})
