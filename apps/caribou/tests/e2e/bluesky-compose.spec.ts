import { expect, test, type Page } from '@playwright/test'
import { ALICE, installFixtureAuth, loopbackOrigin } from './_bluesky-auth.js'

// Bluesky compose through the real SDK (#189, spec 7.2): the counter is the
// SDK's `RichText`, the rkey a TID, and the post goes to the fixture PDS with
// `createRecord`. A lost answer is retried with `getRecord` first, so a post
// is never sent twice.

const PDS = 'https://pds.example.test'
const CID = 'bafyreib7upx3s2pfhghouqwntlb4vsokgkwi7kmeqfsyddvum2xle33riq'
const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/

interface Pds {
  creates: { rkey: string; record: Record<string, unknown> }[]
  gets: string[]
  records: Map<string, Record<string, unknown>>
  /** When true, the next create is written and its answer is lost. */
  loseNextAnswer: boolean
  /** When true, the next getRecord fails with a 502: the outcome stays unknown. */
  failNextGet: boolean
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

async function fixturePds(page: Page): Promise<Pds> {
  const pds: Pds = { creates: [], gets: [], records: new Map(), loseNextAnswer: false, failNextGet: false }
  const json = (body: unknown, status = 200) => ({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  // Registered after the auth fixture, so these answer first.
  await page.route(`${PDS}/xrpc/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = url.pathname.replace('/xrpc/', '')
    if (req.method() === 'OPTIONS') return route.fallback()
    if (method === 'com.atproto.repo.createRecord') {
      const body = req.postDataJSON() as { repo: string; collection: string; rkey: string; record: Record<string, unknown> }
      pds.creates.push({ rkey: body.rkey, record: body.record })
      if (pds.records.has(body.rkey)) return route.fulfill(json({ error: 'InternalServerError', message: 'Internal Server Error' }, 500))
      pds.records.set(body.rkey, body.record)
      if (pds.loseNextAnswer) {
        pds.loseNextAnswer = false
        return route.abort('timedout')
      }
      return route.fulfill(json({ uri: `at://${body.repo}/${body.collection}/${body.rkey}`, cid: CID }))
    }
    if (method === 'com.atproto.repo.getRecord') {
      const rkey = url.searchParams.get('rkey') ?? ''
      pds.gets.push(rkey)
      if (pds.failNextGet) {
        pds.failNextGet = false
        return route.fulfill(json({ error: 'UpstreamFailure', message: 'Bad Gateway' }, 502))
      }
      const value = pds.records.get(rkey)
      return route.fulfill(value
        ? json({ uri: `at://${ALICE}/app.bsky.feed.post/${rkey}`, cid: CID, value })
        : json({ error: 'RecordNotFound', message: 'Could not locate record' }, 400))
    }
    // The AppView has not caught up yet: the post is not there.
    if (method === 'app.bsky.feed.getPosts') return route.fulfill(json({ posts: [] }))
    return route.fallback()
  })
  return pds
}

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/`)
  // The panels are in the server HTML: wait for the router's mount swap, or
  // the tab click lands on the mount it drops.
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${origin}/home`)
}

async function openCompose(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'New post' })
  // `n` does nothing until the page has hydrated and the session restored;
  // press again until the dialog opens (an open dialog ignores it).
  await expect(async () => {
    await page.locator('body').click({ position: { x: 1, y: 1 } })
    await page.keyboard.press('n')
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  return dialog
}

test.describe('Bluesky compose', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('counts as the SDK counts, and posts once with a TID rkey', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    await installFixtureAuth(page)
    const pds = await fixturePds(page)
    await signIn(page, origin)
    const dialog = await openCompose(page)
    await expect(dialog.getByRole('combobox', { name: 'Visibility' })).toHaveCount(0)

    const text = dialog.getByRole('textbox', { name: 'Post text' })
    // One family emoji is one grapheme.
    await text.fill('👨‍👩‍👧‍👦')
    await expect(dialog.locator('.count')).toHaveText('299')
    // 300 of them are 7500 bytes: over the byte limit.
    await text.fill('👨‍👩‍👧‍👦'.repeat(300))
    await expect(dialog.getByRole('button', { name: 'Post' })).toBeDisabled()

    await text.fill('hello from caribou #tag')
    await dialog.getByRole('button', { name: 'Post' }).click()
    await expect(dialog).toBeHidden()
    expect(pds.creates).toHaveLength(1)
    expect(pds.creates[0]!.rkey).toMatch(TID)
    expect(pds.creates[0]!.record).toMatchObject({
      $type: 'app.bsky.feed.post', text: 'hello from caribou #tag',
      facets: [{ index: { byteStart: 19, byteEnd: 23 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tag' }] }],
    })
  })

  test('the first send is written but its answer is lost: the retry finds it, one post', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    await installFixtureAuth(page)
    const pds = await fixturePds(page)
    await signIn(page, origin)
    const dialog = await openCompose(page)
    await dialog.getByRole('textbox', { name: 'Post text' }).fill('only once')
    pds.loseNextAnswer = true
    // The check right after the lost answer fails too: the outcome is unknown.
    pds.failNextGet = true
    await dialog.getByRole('button', { name: 'Post' }).click()
    // Wait for the send to end (its toast), not only for the note: a reload
    // while the check is still running would leave the 502 for after it.
    await expect(page.getByText('Post again to retry', { exact: false })).toBeVisible()
    await expect(dialog.getByText('The last send did not finish.', { exact: false })).toBeVisible()

    // A reload keeps the draft, its rkey and the frozen record.
    await page.reload()
    const again = await openCompose(page)
    await expect(again.getByRole('textbox', { name: 'Post text' })).toHaveValue('only once')
    await again.getByRole('button', { name: 'Post' }).click()
    await expect(again).toBeHidden()
    expect(pds.creates).toHaveLength(1)
    // The failed check, then the check after the reload.
    expect(pds.gets).toEqual([pds.creates[0]!.rkey, pds.creates[0]!.rkey])
  })

  test('the answer is lost but the check right after finds the post: one post, the dialog closes', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    await installFixtureAuth(page)
    const pds = await fixturePds(page)
    await signIn(page, origin)
    const dialog = await openCompose(page)
    await dialog.getByRole('textbox', { name: 'Post text' }).fill('checked at once')
    pds.loseNextAnswer = true
    await dialog.getByRole('button', { name: 'Post' }).click()
    await expect(dialog).toBeHidden()
    expect(pds.creates).toHaveLength(1)
    expect(pds.gets).toEqual([pds.creates[0]!.rkey])
  })

  // #200: the card comes from Bluesky's `cardyb` service (routed here, never
  // the network), and its image is uploaded with `uploadBlob` at Post.
  test('a link gets a card; Post uploads its image and sends an external embed', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    await installFixtureAuth(page)
    const pds = await fixturePds(page)
    const extracts: string[] = []
    await page.route('https://cardyb.bsky.app/v1/extract**', async (route) => {
      extracts.push(new URL(route.request().url()).searchParams.get('url') ?? '')
      await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({
        error: '', likely_type: 'html', url: 'https://example.com/a', title: 'Example title', description: 'Example description',
        image: 'https://cardyb.bsky.app/v1/image?url=https%3A%2F%2Fexample.com%2Fog.png',
      }) })
    })
    // A 1x1 PNG.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await page.route('https://cardyb.bsky.app/v1/image**', (route) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: png }))
    let uploads = 0
    await page.route(`${PDS}/xrpc/com.atproto.repo.uploadBlob`, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback()
      uploads += 1
      await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({
        blob: { $type: 'blob', ref: { $link: CID }, mimeType: 'image/jpeg', size: 100 },
      }) })
    })
    await signIn(page, origin)
    const dialog = await openCompose(page)
    await dialog.getByRole('textbox', { name: 'Post text' }).pressSequentially('see https://example.com/a', { delay: 20 })
    await expect(dialog.getByText('Example title')).toBeVisible()
    // Rule 3: one fetch for the whole typed link, not one per key.
    expect(extracts).toEqual(['https://example.com/a'])
    await dialog.getByRole('button', { name: 'Post' }).click()
    await expect(dialog).toBeHidden()
    expect(uploads).toBe(1)
    expect(pds.creates).toHaveLength(1)
    expect(pds.creates[0]!.record.embed).toMatchObject({
      $type: 'app.bsky.embed.external',
      external: { uri: 'https://example.com/a', title: 'Example title', description: 'Example description', thumb: { mimeType: 'image/jpeg' } },
    })
  })
})
