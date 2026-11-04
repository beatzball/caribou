import { expect, test, type Page } from './_fixtures.js'

// Keyboard shortcuts (#53): `components/_shortcuts.ts`.

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

const ALICE = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: AVATAR, avatar_static: AVATAR,
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}
const BOB = { ...ALICE, id: 'b1', username: 'bob', acct: 'bob', display_name: 'Bob Example', url: `https://${INSTANCE}/@bob` }

function makeStatus(id: string, over: Record<string, unknown> = {}) {
  return {
    id, uri: `https://${INSTANCE}/@bob/${id}`, url: `https://${INSTANCE}/@bob/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: BOB, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
    ...over,
  }
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function seed(page: Page, prefs: Record<string, unknown> = {}) {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: ALICE, createdAt: 1,
  }
  await page.addInitScript(({ data, prefs }) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
    localStorage.setItem(`caribou.prefs.${data.userKey}`, JSON.stringify(prefs))
  }, { data: session, prefs })
  await page.route('**/a.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('since_id') || u.searchParams.get('max_id')) return route.fulfill({ json: [] })
    return route.fulfill({ json: [makeStatus('1'), makeStatus('2'), makeStatus('3')] })
  })
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  return errors
}

/** The `<li>` of each post on the timeline. */
const items = (page: Page) => page.locator('caribou-timeline li')

test('j and k move focus from post to post, with a name and a ring', async ({ page }) => {
  await seed(page)
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  await expect(items(page)).toHaveCount(3)

  await page.keyboard.press('j')
  await expect(items(page).nth(0)).toBeFocused()
  await expect(items(page).nth(0)).toHaveAttribute('aria-label', /Post by Bob Example @bob\. post 1/)
  // The focus ring comes from the tokens: an accent outline.
  const outline = await items(page).nth(0).evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).toBe('solid')

  await page.keyboard.press('j')
  await expect(items(page).nth(1)).toBeFocused()
  await page.keyboard.press('j')
  await expect(items(page).nth(2)).toBeFocused()
  await page.keyboard.press('j')
  await expect(items(page).nth(2)).toBeFocused()
  await page.keyboard.press('k')
  await expect(items(page).nth(1)).toBeFocused()
  expect(errors).toEqual([])
})

test('f, b and r act on the focused post', async ({ page }) => {
  await seed(page)
  const calls: string[] = []
  await page.route('**/api/v1/statuses/2/favourite', (route) => {
    calls.push('favourite')
    return route.fulfill({ json: makeStatus('2', { favourited: true, favourites_count: 1 }) })
  })
  await page.route('**/api/v1/statuses/2/reblog', (route) => {
    calls.push('reblog')
    return route.fulfill({ json: makeStatus('r2', { reblog: makeStatus('2', { reblogged: true, reblogs_count: 1 }) }) })
  })
  await gotoSettled(page, '/home')
  await expect(items(page)).toHaveCount(3)
  await page.keyboard.press('j')
  await page.keyboard.press('j')

  const card = items(page).nth(1)
  await page.keyboard.press('f')
  await expect(card.getByRole('button', { name: 'Unfavourite' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('b')
  await expect(card.getByRole('button', { name: 'Undo boost' })).toHaveAttribute('aria-pressed', 'true')
  expect(calls).toEqual(['favourite', 'reblog'])
  // Focus stays on the post.
  await expect(card).toBeFocused()

  await page.keyboard.press('r')
  const dialog = page.getByRole('dialog', { name: /Reply/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Post text' })).toBeFocused()
})

test('o and Enter open the focused post', async ({ page }) => {
  await seed(page)
  await page.route('**/api/v1/statuses/1', (route) => route.fulfill({ json: makeStatus('1') }))
  await page.route('**/api/v1/statuses/1/context', (route) => route.fulfill({ json: { ancestors: [], descendants: [] } }))
  await gotoSettled(page, '/home')
  await expect(items(page)).toHaveCount(3)
  await page.keyboard.press('j')
  await page.keyboard.press('o')
  await expect(page).toHaveURL(/\/@bob\/1$/)

  await page.goBack()
  await expect(items(page)).toHaveCount(3)
  await page.keyboard.press('j')
  await expect(items(page).nth(0)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/@bob\/1$/)
})

test('n opens compose, and g then a letter goes to a page', async ({ page }) => {
  await seed(page)
  await page.route('**/api/v1/lists', (route) => route.fulfill({ json: [] }))
  await gotoSettled(page, '/home')
  await expect(items(page)).toHaveCount(3)

  await page.keyboard.press('n')
  const compose = page.getByRole('dialog', { name: 'New post' })
  await expect(compose).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(compose).toBeHidden()

  for (const [key, path] of [['n', '/notifications'], ['l', '/lists'], ['s', '/search'], ['h', '/home']] as const) {
    await page.keyboard.press('g')
    await page.keyboard.press(key)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
  }
  // `g n` went to notifications and did not open compose.
  await expect(compose).toHaveCount(0)
})

test('/ focuses the search box, and keys typed there are text', async ({ page }) => {
  await seed(page)
  await gotoSettled(page, '/home')
  await expect(items(page)).toHaveCount(3)

  await page.keyboard.press('/')
  const box = page.locator('caribou-right-rail').getByRole('searchbox', { name: 'Search' })
  await expect(box).toBeFocused()
  await page.keyboard.type('jkfn?')
  await expect(box).toHaveValue('jkfn?')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  for (let i = 0; i < 3; i++) await expect(items(page).nth(i)).not.toBeFocused()
})

test('? opens the help sheet; Esc and ? close it, and focus goes back', async ({ page }) => {
  await seed(page)
  await gotoSettled(page, '/home')
  await expect(items(page)).toHaveCount(3)
  await page.keyboard.press('j')

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help).toBeVisible()
  await expect(help.getByText('Next post')).toBeVisible()
  // Keys other than ? do nothing while it is open.
  await page.keyboard.press('j')
  await expect(help).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(help).toHaveCount(0)
  await expect(items(page).nth(0)).toBeFocused()
  await expect(items(page).nth(0)).toHaveAttribute('aria-label', /Post by Bob Example/)

  await page.keyboard.press('?')
  await expect(help).toBeVisible()
  await page.keyboard.press('?')
  await expect(help).toHaveCount(0)
  await expect(items(page).nth(0)).toBeFocused()
})

test('no shortcut fires while another dialog is open', async ({ page }) => {
  await seed(page)
  await gotoSettled(page, '/home')
  await expect(items(page)).toHaveCount(3)
  await page.keyboard.press('n')
  const compose = page.getByRole('dialog', { name: 'New post' })
  await expect(compose).toBeVisible()
  // Focus off the text field, still inside the dialog.
  await compose.getByRole('button', { name: 'Cancel' }).focus()
  await page.keyboard.press('?')
  await page.keyboard.press('j')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)
  for (let i = 0; i < 3; i++) await expect(items(page).nth(i)).not.toBeFocused()
})

test('j works on notifications', async ({ page }) => {
  await seed(page)
  await page.route('**/api/v1/notifications*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('max_id') || u.searchParams.get('min_id') || u.searchParams.get('limit')) {
      return route.fulfill({ json: [] })
    }
    return route.fulfill({
      json: [
        { id: 'n1', type: 'mention', created_at: '2024-01-01T00:00:00.000Z', account: BOB, status: makeStatus('m1', { content: '<p>hi @alice</p>' }) },
        { id: 'n2', type: 'favourite', created_at: '2024-01-01T00:00:00.000Z', account: BOB, status: makeStatus('m2', { account: ALICE }) },
      ],
    })
  })
  await gotoSettled(page, '/notifications')
  const list = page.locator('caribou-notifications li')
  await expect(list).toHaveCount(2)
  await page.keyboard.press('j')
  await expect(list.nth(0)).toBeFocused()
  await page.keyboard.press('j')
  await expect(list.nth(1)).toBeFocused()
  await expect(list.nth(1)).toHaveAttribute('aria-label', /^Bob Example favourited your post.*Post by Alice Example/)
})

test('the setting turns shortcuts off', async ({ page }) => {
  await seed(page, { shortcuts: false })
  await gotoSettled(page, '/home')
  await expect(items(page)).toHaveCount(3)
  await page.keyboard.press('j')
  await page.keyboard.press('?')
  await page.keyboard.press('n')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  for (let i = 0; i < 3; i++) await expect(items(page).nth(i)).not.toBeFocused()

  // Turning them on in /settings works at once.
  await gotoSettled(page, '/settings#keyboard')
  const box = page.getByRole('checkbox', { name: 'Use keyboard shortcuts' })
  await expect(box).not.toBeChecked()
  await box.check()
  await box.blur()
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
})

test('Show keyboard shortcuts on /settings opens the help sheet', async ({ page }) => {
  await seed(page)
  await gotoSettled(page, '/settings')
  await page.getByRole('button', { name: 'Show keyboard shortcuts' }).click()
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
})

test('no shortcut fires while an ALT description is open, though focus stays on ALT', async ({ page }) => {
  await seed(page)
  const media = {
    id: 'm1', type: 'image', url: `https://${INSTANCE}/a.png`, preview_url: `https://${INSTANCE}/a.png`,
    remote_url: null, description: 'A red fox in the snow', blurhash: null,
    meta: { original: { width: 1, height: 1 }, small: { width: 1, height: 1 } },
  }
  await page.unroute('**/api/v1/timelines/home*')
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('since_id') || u.searchParams.get('max_id')) return route.fulfill({ json: [] })
    return route.fulfill({ json: [makeStatus('1', { media_attachments: [media] }), makeStatus('2')] })
  })
  const faved: string[] = []
  await page.route('**/api/v1/statuses/*/favourite', (route) => {
    faved.push(route.request().url())
    return route.fulfill({ json: makeStatus('1', { favourited: true }) })
  })
  await gotoSettled(page, '/home')
  const alt = page.getByRole('button', { name: 'ALT, show the description' })
  await alt.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('A red fox in the snow')).toBeVisible()
  await expect(alt).toBeFocused()

  for (const key of ['n', 'j', 'f', '?']) await page.keyboard.press(key)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(alt).toBeFocused()
  expect(faved).toEqual([])

  // Closed, the keys work again.
  await page.keyboard.press('Escape')
  await expect(page.getByText('A red fox in the snow')).toBeHidden()
  await page.keyboard.press('j')
  await expect(items(page).nth(1)).toBeFocused()
})
