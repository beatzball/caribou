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

function previewCard(over: Record<string, unknown> = {}) {
  return {
    url: 'https://news.example/story', title: 'A story', description: 'What happened today.',
    type: 'link', author_name: '', author_url: '', provider_name: 'Example News', provider_url: '',
    html: '', width: 1200, height: 600, image: `${FILES}/card.png`, image_description: 'A chart',
    embed_url: '', blurhash: null, authors: [],
    ...over,
  }
}

function status(id: string, over: Record<string, unknown> = {}) {
  return {
    id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: ACCOUNT, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [], card: previewCard(),
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
    ...over,
  }
}

// 1×1 transparent PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function openHome(page: Page, statuses: unknown[]) {
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const body = u.searchParams.get('since_id') || u.searchParams.get('max_id') ? [] : statuses
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
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

test('a post with a link shows one card link, named by its title, that opens in a new tab', async ({ page }) => {
  await page.route(`${FILES}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await openHome(page, [status('a')])

  const card = page.locator('caribou-status-link-card')
  const link = card.getByRole('link')
  await expect(link).toHaveCount(1)
  await expect(link).toHaveAccessibleName('A story')
  await expect(link).toHaveAttribute('href', 'https://news.example/story')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(link).toHaveAttribute('data-layout', 'large')
  await expect(card.locator('img')).toHaveAttribute('alt', 'A chart')
  await expect(card.locator('.description')).toHaveText('What happened today.')
  await expect(card.locator('.byline')).toHaveText('Example News')

  // Link-hint tools (Vimium) keep a link only if a hit test at its centre,
  // walking down through shadow roots, lands inside it. See interactions.spec.ts.
  const hit = await page.locator('caribou-status-card').evaluate((el) => {
    const host = el.shadowRoot!.querySelector('caribou-status-link-card')!
    const a = host.shadowRoot!.querySelector('a')!
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
  })
  expect(hit).toBe(true)
})

test('the card holds its size before its image arrives', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route(`${FILES}/**`, async (route) => {
    await held
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
  })
  await openHome(page, [status('a')])
  const box = page.locator('caribou-status-link-card .image')
  await expect(box).toHaveCount(1)
  const before = await box.boundingBox()
  const post = await page.locator('caribou-status-card').boundingBox()
  // 1200×600 is 2:1.
  expect(Math.abs(before!.width / before!.height - 2)).toBeLessThan(0.02)
  release()
  await expect.poll(() => box.locator('img').evaluate((img: HTMLImageElement) => img.complete)).toBe(true)
  expect(await box.boundingBox()).toEqual(before)
  expect(await page.locator('caribou-status-card').boundingBox()).toEqual(post)
})

test('a small image is a compact row, a post with media has no card, and no image means text only', async ({ page }) => {
  await page.route(`${FILES}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  const media = [{
    id: 'm1', type: 'image', url: `${FILES}/m1.png`, preview_url: `${FILES}/m1-small.png`,
    remote_url: null, description: null, blurhash: null,
    meta: { small: { width: 400, height: 200, size: '400x200', aspect: 2 } },
  }]
  await openHome(page, [
    status('a', { card: previewCard({ width: 200, height: 200 }) }),
    status('b', { media_attachments: media }),
    status('c', { card: previewCard({ image: null }) }),
  ])
  const cards = page.locator('caribou-status-card')
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(0).locator('caribou-status-link-card a')).toHaveAttribute('data-layout', 'compact')
  await expect(cards.nth(1).locator('caribou-status-media')).toHaveCount(1)
  await expect(cards.nth(1).locator('caribou-status-link-card')).toHaveCount(0)
  await expect(cards.nth(2).locator('caribou-status-link-card a')).toHaveAttribute('data-layout', 'text')
  await expect(cards.nth(2).locator('caribou-status-link-card img')).toHaveCount(0)
})

test('a long link in the post text is shortened, and keeps its full URL as its name', async ({ page }) => {
  const href = 'https://www.news.example/2026/10/a-very-long-path-to-the-story'
  const content = `<p>read <a href="${href}" target="_blank" rel="nofollow noopener noreferrer">`
    + '<span class="invisible">https://www.</span><span class="ellipsis">news.example/2026/10/a-very-lo</span>'
    + '<span class="invisible">ng-path-to-the-story</span></a></p>'
  await openHome(page, [status('a', { content, card: null })])
  const a = page.locator('caribou-status-card .status-content a')
  await expect(a).toHaveAttribute('href', href)
  // The hidden parts stay in the text: a screen reader, and a copy of the
  // link text, get the whole URL.
  await expect(a).toHaveAccessibleName(href)
  // Only the shown part takes up room, followed by "…".
  const parts = await a.locator('span').evaluateAll((spans) => spans.map((el) => {
    const r = el.getBoundingClientRect()
    return [el.className, r.width > 0 && r.height > 0]
  }))
  expect(parts).toEqual([['invisible', false], ['ellipsis', true], ['invisible', false]])
  const after = await a.locator('.ellipsis').evaluate((el) => getComputedStyle(el, '::after').content)
  // Serialized as `"…" / ""` where the alt-text form is supported.
  expect(after).toMatch(/^"…"/)
})
