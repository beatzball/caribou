import { expect, test, type Page } from './_fixtures.js'

const INSTANCE = 'example.social'
const FILES = `https://files.${INSTANCE}`

const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: '', avatar_static: '',
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

const BOB = { ...ACCOUNT, id: 'b1', username: 'bob', acct: 'bob', display_name: 'Bob Example', url: `https://${INSTANCE}/@bob` }

function status(id: string, over: Record<string, unknown> = {}) {
  return {
    id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: ACCOUNT, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
    ...over,
  }
}

const IMAGE = {
  id: 'm1', type: 'image', url: `${FILES}/m1.png`, preview_url: `${FILES}/m1-small.png`,
  remote_url: null, description: null, blurhash: null,
  meta: { small: { width: 400, height: 200, size: '400x200', aspect: 2 } },
}

// 1×1 transparent PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function settled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

async function openHome(page: Page, statuses: unknown[]) {
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const body = u.searchParams.get('since_id') || u.searchParams.get('max_id') ? [] : statuses
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await settled(page, '/home')
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  return errors
}

test.beforeEach(async ({ page }) => {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: ACCOUNT, createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
})

test('a post behind a content warning opens and closes, and loads no media before it opens', async ({ page }) => {
  const errors = collectErrors(page)
  const requested: string[] = []
  await page.route(`${FILES}/**`, (route) => {
    requested.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
  })
  await openHome(page, [status('a', { spoiler_text: 'Finale spoilers', sensitive: true, media_attachments: [IMAGE] })])

  const card = page.locator('caribou-status-card')
  await expect(card.locator('.spoiler')).toHaveText('Finale spoilers')
  await expect(card.getByText('post a')).toHaveCount(0)
  await expect(card.locator('caribou-status-media')).toHaveCount(0)
  const toggle = card.locator('button.cw-toggle')
  await expect(toggle).toHaveText('Show more')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toHaveAttribute('aria-controls', 'status-body')
  await expect(card.locator('#status-body')).toBeHidden()
  expect(requested).toEqual([])

  // Keyboard: focus stays on the button, which now says Show less.
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveText('Show less')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toBeFocused()
  await expect(card.getByText('post a')).toBeVisible()
  // The reveal opens the sensitive media too, and it keeps its Hide button.
  const media = card.locator('caribou-status-media')
  await expect(media.locator('img')).toHaveCount(1)
  await expect(media.getByRole('button', { name: 'Hide' })).toBeVisible()
  await expect.poll(() => requested.length).toBeGreaterThan(0)

  await page.keyboard.press('Enter')
  await expect(toggle).toHaveText('Show more')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await expect(card.getByText('post a')).toHaveCount(0)
  await expect(media).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a boost shows the warning of the boosted post', async ({ page }) => {
  await openHome(page, [status('w', {
    account: BOB, content: '', spoiler_text: '',
    reblog: status('i', { spoiler_text: 'Boosted warning' }),
  })])
  const card = page.locator('caribou-status-card')
  await expect(card.locator('.boost-attribution')).toContainText('boosted')
  await expect(card.locator('.spoiler')).toHaveText('Boosted warning')
  await expect(card.getByText('post i')).toHaveCount(0)
  await card.getByRole('button', { name: 'Show more' }).click()
  await expect(card.getByText('post i')).toBeVisible()
})

// Link-hint tools (Vimium) keep a control only if a hit test at its centre,
// walking down through shadow roots, lands inside it. See interactions.spec.ts.
test('a hit test at the toggle\'s centre lands on it', async ({ page }) => {
  await openHome(page, [status('a', { spoiler_text: 'cw' })])
  const hit = await page.locator('caribou-status-card').evaluate((el) => {
    const b = el.shadowRoot!.querySelector('button.cw-toggle')!
    const r = b.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    let root: Document | ShadowRoot = document
    const seen: Element[] = []
    for (;;) {
      const h: Element | undefined = root.elementsFromPoint(x, y)[0]
      if (!h || seen.includes(h)) return h === b || !!h && b.contains(h)
      seen.push(h)
      if (!h.shadowRoot) return h === b || b.contains(h)
      root = h.shadowRoot
    }
  })
  expect(hit).toBe(true)
})

test('a notification\'s post collapses behind its content warning', async ({ page }) => {
  await page.route('**/api/v1/timelines/home*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/notifications*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('max_id') || u.searchParams.get('min_id') || u.searchParams.get('limit')) {
      return route.fulfill({ json: [] })
    }
    return route.fulfill({ json: [{
      id: '1', type: 'mention', created_at: '2024-01-01T00:00:00.000Z', account: BOB, group_key: 'ungrouped-1',
      status: status('n1', { account: BOB, content: '<p>hi @alice</p>', spoiler_text: 'Mention warning' }),
    }] })
  })
  await settled(page, '/notifications')
  const card = page.locator('caribou-notifications caribou-status-card')
  await expect(card.locator('.spoiler')).toHaveText('Mention warning')
  await expect(card.getByText('hi @alice')).toHaveCount(0)
  await card.getByRole('button', { name: 'Show more' }).click()
  await expect(card.getByText('hi @alice')).toBeVisible()
})

test('a link card behind a content warning renders and loads nothing until the post opens', async ({ page }) => {
  const requested: string[] = []
  await page.route(`${FILES}/**`, (route) => {
    requested.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
  })
  await openHome(page, [status('l', {
    spoiler_text: 'Link warning',
    card: {
      url: 'https://news.example/story', title: 'A story', description: 'What happened today.',
      type: 'link', author_name: '', author_url: '', provider_name: 'Example News', provider_url: '',
      html: '', width: 1200, height: 600, image: `${FILES}/card.png`, image_description: 'A chart',
      embed_url: '', blurhash: null, authors: [],
    },
  })])
  const card = page.locator('caribou-status-card')
  await expect(card.locator('.spoiler')).toHaveText('Link warning')
  await expect(card.locator('caribou-status-link-card')).toHaveCount(0)
  expect(requested).toEqual([])

  await card.getByRole('button', { name: 'Show more' }).click()
  await expect(card.locator('caribou-status-link-card').getByRole('link')).toBeVisible()
  await expect.poll(() => requested).toEqual([`${FILES}/card.png`])

  await card.getByRole('button', { name: 'Show less' }).click()
  await expect(card.locator('caribou-status-link-card')).toHaveCount(0)
})
