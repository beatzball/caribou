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
  /** Each `applyWrites` call's writes (#199). */
  applies: { collection: string; rkey: string; value: Record<string, unknown> }[][]
  /** Gate records by `<collection>/<rkey>`. */
  gates: Map<string, Record<string, unknown>>
}

// One of the reader's curate lists, for "who can reply" (#199).
const LIST_RKEY = '3kllaaaaaaaa2'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

async function fixturePds(page: Page): Promise<Pds> {
  const pds: Pds = { creates: [], gets: [], records: new Map(), loseNextAnswer: false, failNextGet: false, applies: [], gates: new Map() }
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
    if (method === 'com.atproto.repo.applyWrites') {
      const body = req.postDataJSON() as { repo: string; writes: { collection: string; rkey: string; value: Record<string, unknown> }[] }
      pds.applies.push(body.writes)
      // One commit: every write lands, or none.
      for (const w of body.writes) {
        if (w.collection === 'app.bsky.feed.post') pds.records.set(w.rkey, w.value)
        else pds.gates.set(`${w.collection}/${w.rkey}`, w.value)
      }
      if (pds.loseNextAnswer) {
        pds.loseNextAnswer = false
        return route.abort('timedout')
      }
      return route.fulfill(json({
        commit: { cid: CID, rev: '3krev' },
        results: body.writes.map((w) => ({ $type: 'com.atproto.repo.applyWrites#createResult', uri: `at://${body.repo}/${w.collection}/${w.rkey}`, cid: CID })),
      }))
    }
    if (method === 'com.atproto.repo.listRecords' && url.searchParams.get('collection') === 'app.bsky.graph.list') {
      return route.fulfill(json({ records: [{
        uri: `at://${ALICE}/app.bsky.graph.list/${LIST_RKEY}`, cid: CID,
        value: { $type: 'app.bsky.graph.list', purpose: 'app.bsky.graph.defs#curatelist', name: 'Friends', createdAt: '2026-11-01T00:00:00.000Z' },
      }] }))
    }
    if (method === 'com.atproto.repo.getRecord' && url.searchParams.get('collection') !== 'app.bsky.feed.post') {
      const key = `${url.searchParams.get('collection')}/${url.searchParams.get('rkey')}`
      const value = pds.gates.get(key)
      return route.fulfill(value
        ? json({ uri: `at://${ALICE}/${key}`, cid: CID, value })
        : json({ error: 'RecordNotFound', message: 'Could not locate record' }, 400))
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

  test('reply and quote limits go with the post in one applyWrites, one rkey (#199)', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    await installFixtureAuth(page)
    const pds = await fixturePds(page)
    await signIn(page, origin)
    const dialog = await openCompose(page)
    await dialog.getByRole('textbox', { name: 'Post text' }).fill('limited')
    const toggle = dialog.getByRole('button', { name: 'Everyone can reply. Quotes are on.' })
    await toggle.click()
    await dialog.getByRole('checkbox', { name: 'Your followers' }).check()
    await dialog.getByRole('combobox', { name: 'People on' }).selectOption({ label: 'Friends' })
    await dialog.getByRole('checkbox', { name: 'Allow quotes' }).uncheck()
    await expect(dialog.getByRole('button', { name: 'Only your followers and people on Friends can reply. Quotes are off.' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(dialog).toBeHidden()

    expect(pds.creates).toHaveLength(0)
    expect(pds.applies).toHaveLength(1)
    const writes = pds.applies[0]!
    expect(writes.map((w) => w.collection)).toEqual(['app.bsky.feed.post', 'app.bsky.feed.threadgate', 'app.bsky.feed.postgate'])
    const rkey = writes[0]!.rkey
    expect(rkey).toMatch(TID)
    expect(writes.every((w) => w.rkey === rkey)).toBe(true)
    const post = `at://${ALICE}/app.bsky.feed.post/${rkey}`
    expect(writes[1]!.value).toMatchObject({
      post, allow: [{ $type: 'app.bsky.feed.threadgate#followerRule' }, { $type: 'app.bsky.feed.threadgate#listRule', list: `at://${ALICE}/app.bsky.graph.list/${LIST_RKEY}` }],
    })
    expect(writes[2]!.value).toMatchObject({ post, embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }] })
  })

  test('the list select follows the choice after picking in it (review 1, F1)', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    await installFixtureAuth(page)
    await fixturePds(page)
    await signIn(page, origin)
    const dialog = await openCompose(page)
    await dialog.getByRole('textbox', { name: 'Post text' }).fill('x')
    await dialog.getByRole('button', { name: 'Everyone can reply. Quotes are on.' }).click()
    const select = dialog.getByRole('combobox', { name: 'People on' })
    await select.selectOption({ label: 'Friends' })
    await select.selectOption({ label: 'no list' })
    await select.selectOption({ label: 'Friends' })
    await dialog.getByRole('radio', { name: 'Everyone' }).check()
    await expect(dialog.getByRole('button', { name: 'Everyone can reply. Quotes are on.' })).toBeVisible()
    await expect(select).toHaveValue('')
  })

  test('limits survive a lost answer: the check reads the gate records too (review 1)', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    await installFixtureAuth(page)
    const pds = await fixturePds(page)
    await signIn(page, origin)
    const dialog = await openCompose(page)
    await dialog.getByRole('textbox', { name: 'Post text' }).fill('gated, checked')
    await dialog.getByRole('button', { name: 'Everyone can reply. Quotes are on.' }).click()
    await dialog.getByRole('radio', { name: 'Nobody' }).check()
    pds.loseNextAnswer = true
    await dialog.getByRole('button', { name: 'Post', exact: true }).click()
    // The check finds the post and its thread gate as sent: posted, once.
    await expect(dialog).toBeHidden()
    expect(pds.applies).toHaveLength(1)
    expect(pds.gates.size).toBe(1)
    expect(pds.gets).toHaveLength(1)
  })
})
