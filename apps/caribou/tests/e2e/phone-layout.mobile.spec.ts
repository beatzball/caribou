import { expect, test, type Page } from './_fixtures.js'

// Runs in the `mobile-webkit` project only (iPhone 15: touch, 393px wide).

const INSTANCE = 'example.social'
const FILES = `https://files.${INSTANCE}`

const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: '', avatar_static: '',
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

// A card whose byline (site · authors) is one long line. The byline does not
// wrap, and it once made the card, and so the page, wider than the phone.
function status(id: string) {
  return {
    id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: ACCOUNT, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    card: {
      url: 'https://news.example/story', title: 'A story', description: 'What happened today.',
      type: 'link', author_name: 'Alice Example, Bob Example, Carol Example, Dave Example and Erin Example', author_url: '', provider_name: 'Example News', provider_url: '',
      html: '', width: 1200, height: 630, image: `${FILES}/card.png`, image_description: '',
      embed_url: '', blurhash: null, authors: [],
    },
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

// 1×1 transparent PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function openHome(page: Page) {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: ACCOUNT, createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
  await page.route(`${FILES}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  const statuses = ['a', 'b', 'c', 'd', 'e', 'f'].map(status)
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const body = u.searchParams.get('since_id') || u.searchParams.get('max_id') ? [] : statuses
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(page.locator('caribou-status-card')).toHaveCount(6)
}

test('a link card with a long byline does not make the page wider than the phone', async ({ page }) => {
  await openHome(page)
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(client)
})

test('the bottom bar is above the posts under it', async ({ page }) => {
  await openHome(page)
  const rail = page.locator('litro-outlet > :not([hidden]) caribou-nav-rail')
  // The hit test at each item's center, walking down through shadow roots,
  // must land inside the bar and not on a card image under it.
  const hits = await rail.evaluate((host) => {
    const nav = host.shadowRoot!.querySelector('nav')!
    // Items moved into the More menu are not shown in the bar.
    const shown = [...nav.querySelectorAll(':scope > a')].filter((a) => a.getBoundingClientRect().width > 0)
    return shown.map((a) => {
      const r = a.getBoundingClientRect()
      let root: Document | ShadowRoot = document
      let el: Element | null = null
      for (;;) {
        const next: Element | null = root.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (!next || next === el) break
        el = next
        if (!el.shadowRoot) break
        root = el.shadowRoot
      }
      // Up through parents and shadow hosts: the icon is in its own shadow root.
      let up: Node | null = el
      while (up && up !== a) up = up.parentNode ?? (up instanceof ShadowRoot ? up.host : null)
      return { href: a.getAttribute('href'), inside: up === a }
    })
  })
  expect(hits.length).toBeGreaterThan(0)
  for (const hit of hits) expect(hit, hit.href ?? '').toMatchObject({ inside: true })
})
