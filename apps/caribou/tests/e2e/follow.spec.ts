import { expect, test, type Page } from './_fixtures.js'

const INSTANCE = 'example.social'

const ALICE = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: `https://${INSTANCE}/a.png`, avatar_static: `https://${INSTANCE}/a.png`,
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 0, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

// Bob as the page data carries him: the server camel-cases upstream JSON.
const BOB = {
  id: 'b1', username: 'bob', acct: 'bob', displayName: 'Bob Example',
  avatar: `https://${INSTANCE}/b.png`, avatarStatic: `https://${INSTANCE}/b.png`,
  url: `https://${INSTANCE}/@bob`, header: '', headerStatic: '', note: '<p>bio of bob</p>',
  followersCount: 1, followingCount: 1, statusesCount: 0, locked: false, bot: false,
  discoverable: true, createdAt: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function relationship(patch: Record<string, unknown>) {
  return {
    id: 'b1', following: false, showing_reblogs: false, notifying: false, languages: [],
    followed_by: false, blocking: false, blocked_by: false, muting: false,
    muting_notifications: false, requested: false, requested_by: false,
    domain_blocking: false, endorsed: false, note: '',
    ...patch,
  }
}

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function signIn(page: Page) {
  await page.addInitScript((account) => {
    const session = {
      userKey: 'alice@example.social', server: 'example.social', token: 'TOKEN',
      vapidKey: '', account, createdAt: 1,
    }
    localStorage.setItem('caribou.users', JSON.stringify([[session.userKey, session]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(session.userKey))
  }, ALICE)
}

async function settled(page: Page) {
  await page.waitForSelector('litro-outlet[data-litro-settled]', { state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

// The server fetches a profile from its instance in the nitro process, where
// `page.route` cannot reach. A client-side navigation asks the server for the
// page data with `Accept: application/json` from the browser, so the test
// starts on /@me, which needs no upstream on the server, and navigates from
// there to a profile whose page data it serves itself.
async function openBobsProfile(page: Page) {
  await page.route('**/api/v1/accounts/lookup*', (route) => route.fulfill(json(ALICE)))
  await page.route('**/api/v1/accounts/a1/statuses*', (route) => route.fulfill(json([])))
  await page.route((url) => url.pathname === `/@bob@${INSTANCE}`, (route) => {
    if (!/application\/json/.test(route.request().headers()['accept'] ?? '')) return route.continue()
    return route.fulfill(json({
      kind: 'ok', account: BOB, statuses: [], nextMaxId: null, tab: 'posts',
      shell: { instance: INSTANCE }, handle: `bob@${INSTANCE}`,
    }))
  })
  await page.goto('/@me')
  await settled(page)
  await page.evaluate((path) => {
    history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, `/@bob@${INSTANCE}`)
  // The old page and the new one share the outlet until the swap.
  await expect(page.locator('caribou-profile-header .handle', { hasText: '@bob' })).toBeVisible()
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test('follow, then unfollow, from a profile', async ({ page, browserName }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await signIn(page)
  const writes: string[] = []
  await page.route('**/api/v1/accounts/relationships*', (route) =>
    route.fulfill(json([relationship({ followed_by: true })])))
  await page.route('**/api/v1/accounts/b1/follow', (route) => {
    writes.push('follow')
    return route.fulfill(json(relationship({ following: true, followed_by: true })))
  })
  await page.route('**/api/v1/accounts/b1/unfollow', (route) => {
    writes.push('unfollow')
    return route.fulfill(json(relationship({ followed_by: true })))
  })
  await openBobsProfile(page)

  const button = page.locator('caribou-profile-header caribou-button.follow')
  await expect(button).toHaveText('Follow')
  await expect(page.locator('caribou-profile-header .follows-you')).toHaveText('Follows you')

  await button.click()
  await expect(button).toHaveAttribute('data-state', 'following')
  // The pointer is still on the button, so it offers what a click would do.
  // `innerText` is what is displayed; the other label is in the DOM, hidden.
  await expect.poll(async () => (await button.innerText()).trim()).toBe('Unfollow')
  await page.mouse.move(0, 0)
  await expect.poll(async () => (await button.innerText()).trim()).toBe('Following')
  // Keyboard focus offers it too. Not every browser focuses a button on a
  // click, so put focus there first, then leave and come back by keyboard.
  await button.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect.poll(async () => (await button.innerText()).trim()).toBe('Unfollow')
  expect(writes).toEqual(['follow'])
  await page.mouse.click(0, 0)
  await expect.poll(async () => (await button.innerText()).trim()).toBe('Following')
  // Chromium also turns focus-visible on for a key pressed while a
  // mouse-focused button keeps focus, with no focus event. Press the mouse
  // on the button and release it elsewhere: focus, but no click.
  if (browserName === 'chromium') {
    const box = (await button.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(0, 0)
    await page.mouse.up()
    await expect.poll(async () => (await button.innerText()).trim()).toBe('Following')
    await page.keyboard.press('Shift')
    await expect.poll(async () => (await button.innerText()).trim()).toBe('Unfollow')
    await page.mouse.click(0, 0)
  }

  await button.click()
  await expect(button).toHaveAttribute('data-state', 'follow')
  await expect(button).toHaveText('Follow')
  expect(writes).toEqual(['follow', 'unfollow'])
  expect(errors).toEqual([])
})

test('a failed follow puts the button back and says so', async ({ page }) => {
  await signIn(page)
  await page.route('**/api/v1/accounts/relationships*', (route) => route.fulfill(json([relationship({})])))
  await page.route('**/api/v1/accounts/b1/follow', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }))
  await openBobsProfile(page)
  const toast = page.evaluate(() => new Promise<unknown>((resolve) => {
    window.addEventListener('caribou:toast', (e) => resolve((e as CustomEvent).detail), { once: true })
  }))
  const button = page.locator('caribou-profile-header caribou-button.follow')
  await button.click()
  expect(await toast).toEqual({ kind: 'error', message: "Couldn't follow @bob." })
  await expect(button).toHaveAttribute('data-state', 'follow')
})

test('no button on the reader’s own profile', async ({ page }) => {
  await signIn(page)
  const relationships: string[] = []
  await page.route('**/api/v1/accounts/relationships*', (route) => {
    relationships.push(route.request().url())
    return route.fulfill(json([]))
  })
  await page.route('**/api/v1/accounts/lookup*', (route) => route.fulfill(json(ALICE)))
  await page.route('**/api/v1/accounts/a1/statuses*', (route) => route.fulfill(json([])))
  await page.goto('/@me')
  await settled(page)
  await expect(page.locator('caribou-profile-header .handle')).toHaveText('@alice')
  await expect(page.locator('caribou-profile-header caribou-button.follow')).toHaveCount(0)
  expect(relationships).toEqual([])
})
