import { expect, test, type Page } from '@playwright/test'

const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/a.png`

const ALICE = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: AVATAR, avatar_static: AVATAR,
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function makeStatus(id: string, content: string) {
  return {
    id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: ALICE, content,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

// `account: null` is what sign-in stores (`server/routes/signin/done.get.ts`);
// the app loads the account afterwards.
async function seedSession(page: Page, account: typeof ALICE | null = ALICE) {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN',
    vapidKey: '', account, createdAt: 1,
  }
  await page.addInitScript((data) => {
    if (localStorage.getItem('caribou.__seeded__') === '1') return
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
    localStorage.setItem('caribou.__seeded__', '1')
  }, session)
}

interface Posted { body: Record<string, unknown>; key: string | undefined }

async function mockApi(page: Page): Promise<Posted[]> {
  const posted: Posted[] = []
  await page.route('**/a.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const body = u.searchParams.get('since_id') || u.searchParams.get('max_id')
      ? [] : [makeStatus('a', '<p>first post</p>')]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.route('**/api/v2/instance', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      domain: INSTANCE,
      configuration: { statuses: { max_characters: 50, max_media_attachments: 4 }, media_attachments: {} },
    }),
  }))
  await page.route('**/api/v1/statuses', (route) => {
    const req = route.request()
    posted.push({ body: req.postDataJSON() as Record<string, unknown>, key: req.headers()['idempotency-key'] })
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(makeStatus('new', '<p>posted</p>')),
    })
  })
  return posted
}

test('n opens compose; Ctrl+Enter posts the right body and closes it', async ({ page }) => {
  await seedSession(page)
  const posted = await mockApi(page)
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  await expect(page.getByText('first post')).toBeVisible()

  await page.keyboard.press('n')
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await expect(dialog).toBeVisible()
  const text = dialog.getByRole('textbox', { name: 'Post text' })
  await expect(text).toBeFocused()
  await text.fill('hello from caribou')
  // The limit comes from the instance: 50 - 18.
  await expect(dialog.locator('.count')).toHaveText('32')
  await dialog.getByLabel('Visibility').selectOption('unlisted')
  await text.press('ControlOrMeta+Enter')

  await expect(dialog).toBeHidden()
  expect(posted).toHaveLength(1)
  expect(posted[0]!.body).toEqual({ status: 'hello from caribou', visibility: 'unlisted' })
  expect(posted[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
  // The draft is gone once posted.
  expect(await page.evaluate(() => localStorage.getItem('caribou.drafts.alice@example.social'))).toBeNull()
  expect(errors).toEqual([])
})

test('the New post button opens compose, and Esc keeps the draft', async ({ page }) => {
  await seedSession(page)
  await mockApi(page)
  await gotoSettled(page, '/home')
  await page.getByRole('button', { name: 'New post' }).click()
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await dialog.getByRole('textbox', { name: 'Post text' }).fill('not done yet')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'New post' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Post text' })).toHaveValue('not done yet')
})

test('a reply shows the post, prefills the mentions and sends in_reply_to_id', async ({ page }) => {
  await seedSession(page)
  const posted = await mockApi(page)
  await gotoSettled(page, '/home')
  // Until cards carry a reply button, open the dialog the way they will.
  await page.evaluate(() => {
    const bob = { id: 'b1', acct: 'bob@example.net', username: 'bob', displayName: 'Bob' }
    window.dispatchEvent(new CustomEvent('caribou:compose', {
      detail: {
        inReplyTo: {
          id: '42', content: '<p>what do you think?</p>', visibility: 'unlisted', spoilerText: '',
          account: bob, mentions: [{ acct: 'alice' }, { acct: 'carol' }],
        },
      },
    }))
  })
  const dialog = page.getByRole('dialog', { name: 'Reply' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('what do you think?')).toBeVisible()
  const text = dialog.getByRole('textbox', { name: 'Post text' })
  await expect(text).toHaveValue('@bob@example.net @carol ')
  await text.press('End')
  await text.pressSequentially('sounds good')
  await dialog.getByRole('button', { name: 'Reply' }).click()
  await expect(dialog).toBeHidden()
  expect(posted[0]!.body).toEqual({
    status: '@bob@example.net @carol sounds good', visibility: 'unlisted', in_reply_to_id: '42',
  })
})

test('a failed post keeps the dialog open with the draft', async ({ page }) => {
  await seedSession(page)
  await mockApi(page)
  await page.route('**/api/v1/statuses', (route) => route.fulfill({
    status: 422, contentType: 'application/json',
    body: JSON.stringify({ error: 'Validation failed: try again' }),
  }))
  await gotoSettled(page, '/home')
  await page.keyboard.press('n')
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await dialog.getByRole('textbox', { name: 'Post text' }).fill('keep this')
  await dialog.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Post text' })).toHaveValue('keep this')
})

test('plain Enter in the content warning field does not publish', async ({ page }) => {
  await seedSession(page)
  const posted = await mockApi(page)
  await gotoSettled(page, '/home')
  await page.keyboard.press('n')
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await dialog.getByRole('textbox', { name: 'Post text' }).fill('body')
  await dialog.getByRole('button', { name: 'CW' }).click()
  const cw = dialog.getByRole('textbox', { name: 'Content warning' })
  await cw.fill('spoiler')
  await cw.press('Enter')
  // Give a stray submit time to reach the network.
  await page.waitForTimeout(300)
  expect(posted).toHaveLength(0)
  await expect(dialog).toBeVisible()
})

test('signed out: no New post button and n does nothing', async ({ page }) => {
  await page.route('**/a.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  await expect(page.getByRole('button', { name: 'New post' })).toHaveCount(0)
  await page.keyboard.press('n')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a fresh sign-in (no stored account yet): cards load, New post and Reply open', async ({ page }) => {
  await seedSession(page, null)
  await mockApi(page)
  // The account never loads, so every reader must cope with null.
  await page.route('**/api/v1/accounts/verify_credentials', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }))
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  await expect(page.getByText('first post')).toBeVisible()

  await page.getByRole('button', { name: 'New post' }).click()
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Visibility')).toHaveValue('public')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // Alice's own post: the reply does not mention her.
  await page.getByRole('button', { name: 'Reply' }).first().click()
  const reply = page.getByRole('dialog', { name: 'Reply' })
  await expect(reply).toBeVisible()
  await expect(reply.getByRole('textbox', { name: 'Post text' })).toHaveValue('')
  // The 500 above is the only expected error.
  expect(errors.filter((e) => !e.includes('500'))).toEqual([])
})

test('a fresh sign-in loads the account once, and compose then uses its default visibility', async ({ page }) => {
  await seedSession(page, null)
  await mockApi(page)
  let calls = 0
  await page.route('**/api/v1/accounts/verify_credentials', (route) => {
    calls += 1
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...ALICE, source: { privacy: 'unlisted', note: '', fields: [] } }),
    })
  })
  const errors = collectErrors(page)
  await gotoSettled(page, '/home')
  await expect.poll(() => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('caribou.users') ?? '[]') as [string, { account: { id: string } | null }][])[0]?.[1].account?.id,
  )).toBe('a1')
  await page.getByRole('button', { name: 'New post' }).click()
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await expect(dialog.getByLabel('Visibility')).toHaveValue('unlisted')

  // A reload finds the stored account and does not ask again.
  await page.reload()
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.getByText('first post')).toBeVisible()
  expect(calls).toBe(1)
  expect(errors).toEqual([])
})
