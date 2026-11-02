import { expect, test, type Page } from './_fixtures.js'
import {
  ALICE, API, BOB, CAROL, INSTANCE, card, collectErrors, gotoSettled, homeWith, json, match,
  relationship, signIn, status,
} from './_moderation.js'

// Server filters, mute and block (#54): the home timeline honors the
// reader's filters, the post menu and the profile header mute and block,
// and /settings/moderation lists filters, mutes and blocks.

test.describe('server filters on /home', () => {
  test('hide removes the post, warn names the filter with a Show button, other contexts do nothing', async ({ page }) => {
    const errors = collectErrors(page)
    await signIn(page)
    await homeWith(page, [
      status('1', BOB),
      status('2', BOB, [match('Politics', 'hide', ['home'])]),
      status('3', CAROL, [match('Spoilers', 'warn', ['home', 'public'])]),
      status('4', CAROL, [match('Sports', 'hide', ['public'])]),
    ])
    await expect(card(page, '1')).toContainText('post 1')
    await expect(card(page, '4')).toContainText('post 4')
    // The hidden post's row is gone: nothing of it, and no empty list item.
    await expect(card(page, '2')).toBeHidden()
    await expect(page.locator('caribou-timeline li:visible')).toHaveCount(3)
    expect(await page.locator('caribou-timeline ul').ariaSnapshot()).not.toContain('post 2')

    const warned = card(page, '3')
    await expect(warned.getByText('Hidden by filter: Spoilers')).toBeVisible()
    await expect(warned).not.toContainText('post 3')
    const show = warned.getByRole('button', { name: 'Show' })
    await expect(show).toHaveAttribute('aria-expanded', 'false')
    await show.focus()
    await page.keyboard.press('Enter')
    await expect(warned).toContainText('post 3')
    const hide = warned.getByRole('button', { name: 'Hide' })
    await expect(hide).toBeFocused()
    await expect(hide).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Space')
    await expect(warned).not.toContainText('post 3')
    expect(errors).toEqual([])
  })

  test('an older server without `filtered` shows every post', async ({ page }) => {
    await signIn(page)
    await homeWith(page, [status('1', BOB), status('2', CAROL)])
    await expect(page.locator('caribou-timeline li:visible')).toHaveCount(2)
    await expect(page.getByText('Hidden by filter')).toHaveCount(0)
  })
})

test.describe('mute and block from a post', () => {
  test('mute: Undo in its place, focused; the author\'s other posts leave; Undo brings them back', async ({ page }) => {
    const errors = collectErrors(page)
    await signIn(page)
    const writes: string[] = []
    await page.route(`${API}/v1/accounts/b1/*`, (route) => {
      const action = new URL(route.request().url()).pathname.split('/').pop()!
      writes.push(action)
      return route.fulfill(json(relationship('b1', { muting: action === 'mute' })))
    })
    await homeWith(page, [status('1', BOB), status('2', CAROL), status('3', BOB)])
    await card(page, '1').getByRole('button', { name: 'More actions' }).click()
    await card(page, '1').getByRole('button', { name: 'Mute @bob' }).click()
    const undo = card(page, '1').getByRole('button', { name: 'Undo' })
    await expect(undo).toBeFocused()
    await expect(card(page, '1')).toContainText('You muted @bob.')
    await expect(card(page, '3')).toBeHidden()
    await expect(card(page, '2')).toContainText('post 2')
    await expect.poll(() => writes).toEqual(['mute'])
    await page.keyboard.press('Enter')
    await expect(card(page, '1')).toContainText('post 1')
    await expect(card(page, '3')).toContainText('post 3')
    await expect.poll(() => writes).toEqual(['mute', 'unmute'])
    await expect(card(page, '1').getByRole('button', { name: 'More actions' })).toBeFocused()
    expect(errors).toEqual([])
  })

  test('block asks first; Cancel leaves the post; a failed block brings it back and says so', async ({ page }) => {
    await signIn(page)
    let blocks = 0
    await page.route(`${API}/v1/accounts/b1/block`, (route) => {
      blocks += 1
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    })
    await homeWith(page, [status('1', BOB)])
    const menu = card(page, '1').getByRole('button', { name: 'More actions' })
    await menu.click()
    await card(page, '1').getByRole('button', { name: 'Block @bob' }).click()
    const dialog = page.getByRole('dialog', { name: 'Block @bob?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(card(page, '1')).toContainText('post 1')
    expect(blocks).toBe(0)

    await menu.click()
    await card(page, '1').getByRole('button', { name: 'Block @bob' }).click()
    await dialog.getByRole('button', { name: 'Block' }).click()
    await expect.poll(() => blocks).toBe(1)
    await expect(page.locator('caribou-toaster')).toContainText("Couldn't block @bob.")
    await expect(card(page, '1')).toContainText('post 1')
    await expect(menu).toBeFocused()
  })
})

test.describe('mute and block on a profile', () => {
  // A profile's page data comes from its instance on the server, which
  // `page.route` cannot reach. A client-side navigation asks for it from the
  // browser instead, so the test starts on /@me and navigates to Bob's
  // profile, as follow.spec.ts does.
  async function openBob(page: Page) {
    const BOB_CAMEL = {
      id: 'b1', username: 'bob', acct: 'bob', displayName: 'BOB', avatar: `https://${INSTANCE}/a.png`,
      avatarStatic: `https://${INSTANCE}/a.png`, url: `https://${INSTANCE}/@bob`, header: '', headerStatic: '',
      note: '', followersCount: 0, followingCount: 0, statusesCount: 0, locked: false, bot: false,
      discoverable: true, createdAt: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
    }
    await page.route(`${API}/v1/accounts/lookup*`, (route) => route.fulfill(json(ALICE)))
    await page.route(`${API}/v1/accounts/a1/statuses*`, (route) => route.fulfill(json([])))
    await page.route((url) => url.pathname === `/@bob@${INSTANCE}`, (route) => {
      if (!/application\/json/.test(route.request().headers()['accept'] ?? '')) return route.continue()
      return route.fulfill(json({
        kind: 'ok', account: BOB_CAMEL, statuses: [], nextMaxId: null, tab: 'posts',
        shell: { instance: INSTANCE }, handle: `bob@${INSTANCE}`,
      }))
    })
    await gotoSettled(page, '/@me')
    await page.evaluate((path) => {
      history.pushState(null, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, `/@bob@${INSTANCE}`)
    await expect(page.locator('caribou-profile-header .handle', { hasText: '@bob' })).toBeVisible()
    await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  }

  test('mute shows Muted; block asks, then shows Blocked and Unblock in place of Follow', async ({ page }) => {
    const errors = collectErrors(page)
    await signIn(page)
    let rel = relationship('b1', { following: true })
    await page.route(`${API}/v1/accounts/relationships*`, (route) => route.fulfill(json([rel])))
    await page.route(`${API}/v1/accounts/b1/*`, (route) => {
      const action = new URL(route.request().url()).pathname.split('/').pop()!
      if (action === 'mute') rel = { ...rel, muting: true, muting_notifications: true }
      if (action === 'unmute') rel = { ...rel, muting: false, muting_notifications: false }
      if (action === 'block') rel = { ...rel, blocking: true, following: false }
      if (action === 'unblock') rel = { ...rel, blocking: false }
      return route.fulfill(json(rel))
    })
    await openBob(page)
    const header = page.locator('caribou-profile-header')
    await expect(header.getByRole('button', { name: 'Following' })).toBeVisible()
    const more = header.getByRole('button', { name: `More actions for @bob` })

    await more.click()
    await header.getByRole('button', { name: 'Mute @bob' }).click()
    await expect(header.locator('.badge.muted')).toHaveText('Muted')
    await more.click()
    await expect(header.getByRole('button', { name: 'Unmute @bob' })).toBeVisible()
    await page.keyboard.press('Escape')

    await more.click()
    await header.getByRole('button', { name: 'Block @bob' }).click()
    await page.getByRole('dialog', { name: 'Block @bob?' }).getByRole('button', { name: 'Block' }).click()
    await expect(header.locator('.badge.blocked')).toHaveText('Blocked')
    const unblock = header.locator('caribou-button.follow')
    await expect(unblock).toHaveAttribute('data-state', 'blocked')
    await expect(unblock).toHaveText('Unblock')
    await unblock.click()
    await expect(header.locator('.badge.blocked')).toHaveCount(0)
    await expect(header.locator('caribou-button.follow')).toHaveAttribute('data-state', 'follow')
    expect(errors).toEqual([])
  })
})

// /local, profiles and threads are server-rendered from a fetch without the
// reader's token, so their posts carry no `filtered`. Signed in, the page
// asks for the reader's copies and the filters apply. The server's own
// upstream fetch is out of `page.route`'s reach, so the test reaches /local
// by a client-side navigation, whose page data the browser asks for.
test('server-rendered posts get the reader\'s filters once the page runs', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await page.route(`${API}/v1/timelines/home*`, (route) => route.fulfill(json([])))
  const camel = (id: string) => ({
    id, uri: `https://${INSTANCE}/@bob/${id}`, url: `https://${INSTANCE}/@bob/${id}`,
    createdAt: '2024-01-01T00:00:00.000Z', content: `<p>post ${id}</p>`, visibility: 'public',
    sensitive: false, spoilerText: '', mediaAttachments: [], mentions: [], tags: [], emojis: [],
    reblogsCount: 0, favouritesCount: 0, repliesCount: 0,
    account: { id: 'b1', username: 'bob', acct: 'bob', displayName: 'BOB', avatar: '', avatarStatic: '',
      url: `https://${INSTANCE}/@bob` },
  })
  await page.route((url) => url.pathname === '/local', (route) => {
    if (!/application\/json/.test(route.request().headers()['accept'] ?? '')) return route.continue()
    return route.fulfill(json({
      kind: 'ok', statuses: [camel('1'), camel('2'), camel('3')], nextMaxId: null,
      shell: { instance: INSTANCE, source: 'cookie' },
    }))
  })
  const asked: string[][] = []
  let release!: () => void
  const released = new Promise<void>((r) => { release = r })
  await page.route(`${API}/v1/statuses?*`, async (route) => {
    const ids = new URL(route.request().url()).searchParams.getAll('id[]')
    asked.push(ids)
    await released
    return route.fulfill(json(ids.map((id) => status(id, BOB,
      id === '2' ? [match('Politics', 'hide', ['public'])]
        : id === '3' ? [match('Spoilers', 'warn', ['public'])] : []))))
  })
  await gotoSettled(page, '/home')
  await page.evaluate(() => {
    history.pushState(null, '', '/local')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  // While the reader's copies are out, no post shows: not even the one a
  // hide filter is about to remove.
  await expect.poll(() => asked).toEqual([['1', '2', '3']])
  await expect(card(page, '1').getByText('Checking this post against your filters…')).toBeVisible()
  for (const id of ['1', '2', '3']) await expect(card(page, id)).not.toContainText(`post ${id}`)
  release()
  await expect(card(page, '1')).toContainText('post 1')
  await expect(card(page, '1').locator('article')).toBeVisible()
  await expect(card(page, '2')).toBeHidden()
  await expect(card(page, '3').getByText('Hidden by filter: Spoilers')).toBeVisible()
  await expect(card(page, '3')).not.toContainText('post 3')
  expect(errors).toEqual([])
})

test('a failed check covers the post with Show and Retry', async ({ page }) => {
  await signIn(page)
  await page.route(`${API}/v1/timelines/home*`, (route) => route.fulfill(json([])))
  await page.route((url) => url.pathname === '/local', (route) => {
    if (!/application\/json/.test(route.request().headers()['accept'] ?? '')) return route.continue()
    return route.fulfill(json({
      kind: 'ok', nextMaxId: null, shell: { instance: INSTANCE, source: 'cookie' },
      statuses: [{
        id: '1', uri: `https://${INSTANCE}/@bob/1`, url: `https://${INSTANCE}/@bob/1`,
        createdAt: '2024-01-01T00:00:00.000Z', content: '<p>post 1</p>', visibility: 'public',
        sensitive: false, spoilerText: '', mediaAttachments: [], mentions: [], tags: [], emojis: [],
        reblogsCount: 0, favouritesCount: 0, repliesCount: 0,
        account: { id: 'b1', username: 'bob', acct: 'bob', displayName: 'BOB', avatar: '', avatarStatic: '' },
      }],
    }))
  })
  let fail = true
  await page.route(`${API}/v1/statuses?*`, (route) => fail
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    : route.fulfill(json([status('1', BOB, [])])))
  await gotoSettled(page, '/home')
  await page.evaluate(() => {
    history.pushState(null, '', '/local')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(card(page, '1').getByText('Could not check this post against your filters.')).toBeVisible()
  await expect(card(page, '1')).not.toContainText('post 1')
  // Held, then a hide: while Retry waits nothing of the post shows, and the
  // focus stays on Retry.
  fail = false
  let answer!: () => void
  const answered = new Promise<void>((r) => { answer = r })
  await page.unroute(`${API}/v1/statuses?*`)
  await page.route(`${API}/v1/statuses?*`, async (route) => {
    await answered
    return route.fulfill(json([status('1', BOB, [match('Politics', 'hide', ['public'])])]))
  })
  const retry = card(page, '1').getByRole('button', { name: 'Retry checking this post' })
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(retry).toHaveAttribute('aria-busy', 'true')
  await expect(card(page, '1')).not.toContainText('post 1')
  await expect(retry).toBeFocused()
  answer()
  await expect(card(page, '1')).toBeHidden()
})

// A signed-in hard load whose app never starts: the head script keeps
// every post hidden, and after 15 s says why, with Reload. Nothing uncovers
// a post nobody has checked.
test('a signed-in page whose app does not start keeps posts hidden and says so', async ({ page }) => {
  await page.clock.install()
  await signIn(page)
  await page.route((url) => url.pathname.startsWith('/_litro/app.js'), (route) => route.abort())
  await page.goto('/home')
  const veil = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--caribou-reader-veil').trim())
  expect(await veil()).toBe('hidden')
  await page.clock.fastForward('00:16')
  const note = page.locator('#caribou-reader-stalled')
  await expect(note).toContainText('Posts are hidden until Caribou has checked them')
  await expect(note.getByRole('link', { name: 'Reload' })).toBeVisible()
  await page.clock.fastForward('10:00')
  expect(await veil()).toBe('hidden')
})

test('/settings links to the moderation page', async ({ page }) => {
  await signIn(page)
  await gotoSettled(page, '/settings')
  await page.getByRole('link', { name: 'Filters, mutes and blocks' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings/moderation')
})

test.describe('/settings/moderation', () => {
  test('signed out: asks to sign in', async ({ page }) => {
    await gotoSettled(page, '/settings/moderation')
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  })

  test('lists filters (read only), mutes and blocks; Unmute and Unblock act in place', async ({ page }) => {
    const errors = collectErrors(page)
    await signIn(page)
    await page.route(`${API}/v2/filters`, (route) => route.fulfill(json([{
      id: 'f1', title: 'Spoilers', context: ['home', 'thread'], filter_action: 'warn', expires_at: null,
      keywords: [{ id: 'k1', keyword: 'finale', whole_word: true }], statuses: [],
    }])))
    await page.route(`${API}/v1/mutes*`, (route) => route.fulfill(json([BOB])))
    await page.route(`${API}/v1/blocks*`, (route) => route.fulfill(json([CAROL])))
    const writes: string[] = []
    await page.route(`${API}/v1/accounts/*/un*`, (route) => {
      writes.push(new URL(route.request().url()).pathname)
      return route.fulfill(json(relationship('x')))
    })
    await gotoSettled(page, '/settings/moderation')
    await expect(page.getByRole('heading', { level: 1, name: 'Filters, mutes and blocks' })).toBeVisible()

    const filters = page.getByRole('region', { name: 'Filters' })
    await expect(filters.getByRole('heading', { name: 'Spoilers' })).toBeVisible()
    await expect(filters).toContainText('Warn · Home and lists, Conversations')
    await expect(filters).toContainText('Words: finale')
    await expect(filters.getByRole('link', { name: `Edit filters on ${INSTANCE}` }))
      .toHaveAttribute('href', `https://${INSTANCE}/filters`)

    const mutes = page.getByRole('region', { name: 'Muted accounts' })
    await mutes.getByRole('button', { name: 'Unmute @bob' }).click()
    await expect(mutes.getByRole('button', { name: 'Mute @bob' })).toBeVisible()
    const blocks = page.getByRole('region', { name: 'Blocked accounts' })
    await blocks.getByRole('button', { name: 'Unblock @carol' }).click()
    await expect(blocks.getByRole('button', { name: 'Block @carol' })).toBeVisible()
    await expect.poll(() => writes.sort()).toEqual(['/api/v1/accounts/b1/unmute', '/api/v1/accounts/c1/unblock'])
    expect(errors).toEqual([])
  })
})
