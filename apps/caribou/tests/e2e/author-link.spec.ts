import { expect, test, type Page } from './_fixtures.js'

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

function account(id: string, acct: string, name: string) {
  const [username, host = INSTANCE] = acct.split('@')
  return {
    id, username, acct, display_name: name,
    avatar: AVATAR, avatar_static: AVATAR,
    url: `https://${host}/@${username}`, header: '', header_static: '', note: '',
    followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
    discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
  }
}

// A local author: `acct` has no host, so the link must add the instance's.
const ALICE = account('a1', 'alice', 'Alice Example')
const BOB = account('b1', 'bob@other.example', 'Bob Remote')

function status(id: string, by: typeof ALICE, over: Record<string, unknown> = {}) {
  return {
    id, uri: `https://${INSTANCE}/@${by.username}/${id}`, url: `https://${INSTANCE}/@${by.username}/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: by, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
    reblog: null, ...over,
  }
}

const POST = status('a', ALICE)
// Bob boosts Alice's post.
const BOOST = status('w', BOB, { content: '', reblog: status('b', ALICE) })

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body: unknown) =>
  ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

async function markDocument(page: Page) {
  await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true })
}

async function sameDocument(page: Page) {
  return page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)
}

test.beforeEach(async ({ page }) => {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: ALICE, createdAt: 1,
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
    return route.fulfill(json([POST, BOOST]))
  })
  await page.route('**/api/v1/accounts/lookup*', (route) => {
    const acct = new URL(route.request().url()).searchParams.get('acct') ?? ''
    return route.fulfill(json(acct.startsWith('bob') ? BOB : ALICE))
  })
  await page.route('**/api/v1/accounts/*/statuses*', (route) => route.fulfill(json([])))
})

const authorLink = (page: Page, nth: number) =>
  page.locator('page-home caribou-status-card').nth(nth).locator('a.author')

test('clicking a post author opens their profile without a full page load, and back returns', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await gotoSettled(page, '/home')
  await markDocument(page)

  const link = authorLink(page, 0)
  await expect(link).toHaveAttribute('href', `/@alice@${INSTANCE}`)
  await expect(link).toHaveAccessibleName(/^Alice Example @alice$/)
  await link.locator('img').click()
  await expect(page).toHaveURL(new RegExp(`/@alice@${INSTANCE}$`))
  // The profile's data comes through the server, which these routes do not
  // reach; the page that asks for it is enough here.
  await expect(page.locator('page-handle')).toHaveCount(1)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  expect(await sameDocument(page)).toBe(true)

  await page.goBack()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.locator('page-home')).toHaveCount(1)
  expect(await sameDocument(page)).toBe(true)
  expect(errors).toEqual([])
})

test('the boost line links the booster to their profile', async ({ page }) => {
  await gotoSettled(page, '/home')
  await markDocument(page)
  const boostCard = page.locator('page-home caribou-status-card').nth(1)
  // The boosted post's author is Alice; the line names Bob.
  await expect(boostCard.locator('a.author')).toHaveAttribute('href', `/@alice@${INSTANCE}`)
  const booster = boostCard.locator('.boost-attribution a')
  await expect(booster).toHaveAttribute('href', '/@bob@other.example')
  await booster.click()
  await expect(page).toHaveURL(/\/@bob@other\.example$/)
  expect(await sameDocument(page)).toBe(true)
})

test('a modifier click on the author is left to the browser', async ({ page }) => {
  await gotoSettled(page, '/home')
  await page.evaluate(() => {
    window.addEventListener('click', (e) => {
      ;(window as unknown as { __prevented: boolean }).__prevented = e.defaultPrevented
      e.preventDefault()
    })
  })
  await authorLink(page, 0).locator('strong').click({ modifiers: ['ControlOrMeta'] })
  expect(await page.evaluate(() => (window as unknown as { __prevented?: boolean }).__prevented)).toBe(false)
  await expect(page).toHaveURL(/\/home$/)
})

// Safari moves between links on Option-Tab; plain Tab skips them by default.
test('the author block is one tab stop, and Tab reaches it', async ({ page, browserName }) => {
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  await gotoSettled(page, '/home')
  const card = page.locator('page-home caribou-status-card').nth(1)
  const focused = () => card.evaluate((el) => {
    const active = el.shadowRoot!.activeElement
    const author = el.shadowRoot!.querySelector('a.author')!
    if (active === null) return 'outside'
    if (active === author) return 'author'
    return author.contains(active) ? 'inside author' : 'next'
  })
  // From the boost line, Tab goes into the author link...
  await card.locator('.boost-attribution a').focus()
  await page.keyboard.press(tab)
  expect(await focused()).toBe('author')
  // ...and the next Tab leaves the author block.
  await page.keyboard.press(tab)
  expect(await focused()).toBe('next')
})

// Link-hint tools (Vimium) keep a link only if a hit test at its centre,
// walking down through shadow roots, lands inside it. See interactions.spec.ts.
test('a hit test at the author link\'s centre lands inside it', async ({ page }) => {
  await gotoSettled(page, '/home')
  const card = page.locator('page-home caribou-status-card').nth(1)
  for (const selector of ['a.author', '.boost-attribution a']) {
    const hit = await card.evaluate((el, sel) => {
      const a = el.shadowRoot!.querySelector(sel)!
      const r = a.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      let root: Document | ShadowRoot = document
      const seen: Element[] = []
      for (;;) {
        const h: Element | undefined = root.elementsFromPoint(x, y)[0]
        if (!h || seen.includes(h)) return h === a || !!h && a.contains(h)
        seen.push(h)
        if (!h.shadowRoot) return h === a || a.contains(h)
        root = h.shadowRoot
      }
    }, selector)
    expect(hit, selector).toBe(true)
  }
})
