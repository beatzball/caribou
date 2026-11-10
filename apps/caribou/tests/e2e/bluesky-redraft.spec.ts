import { expect, test, type Page } from '@playwright/test'
import { ALICE, installFixtureAuth, loopbackOrigin, type XrpcAnswer } from './_bluesky-auth.js'

// Bluesky delete and redraft through the real SDK (#190; app README,
// "Bluesky delete and redraft"). The record and its image are read from the
// fixture PDS first; the image is re-encoded and uploaded, and the draft
// stored, before the post is deleted with `deleteRecord`. The new draft
// posts with a new rkey.

const PDS = 'https://pds.example.test'
const OLD_RKEY = '3lalicepost1'
const OLD_URI = `at://${ALICE}/app.bsky.feed.post/${OLD_RKEY}`
const POST_CID = 'bafyreib7upx3s2pfhghouqwntlb4vsokgkwi7kmeqfsyddvum2xle33riq'
// A 1×1 PNG the browser can decode and re-encode, and its raw CID.
const IMAGE_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const BLOB_CID = 'bafkreidlp6sdj6jkroakvmbntpy2clsj77foijheae5byt3iwz7d2k542a'
// The CID the fixture answers for the re-encoded upload.
const NEW_CID = 'bafkreibsiyovxulxgajkz3ylufldm5jjjg6xylhfb6ixefm5t5lm6dozv4'
// Bluesky's own labeler. The AppView says which labelers' labels an answer
// carries; with it, and the labeler's definitions, the reader's check settles.
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const COVERED = { 'atproto-content-labelers': `${BSKY_LABELER};redact` }
const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/

const RECORD = {
  $type: 'app.bsky.feed.post',
  text: 'a deer photo',
  embed: {
    $type: 'app.bsky.embed.images',
    images: [{
      image: { $type: 'blob', ref: { $link: BLOB_CID }, mimeType: 'image/png', size: IMAGE_BYTES.length },
      alt: 'a deer in snow', aspectRatio: { width: 4, height: 3 },
    }],
  },
  langs: ['en'],
  createdAt: '2026-11-05T10:00:00.000Z',
}

const POST_VIEW = {
  $type: 'app.bsky.feed.defs#postView',
  uri: OLD_URI, cid: POST_CID,
  author: { did: ALICE, handle: 'alice.example.com', displayName: 'Alice', labels: [] },
  record: RECORD,
  embed: {
    $type: 'app.bsky.embed.images#view',
    images: [{ thumb: `${PDS}/img/thumb.jpg`, fullsize: `${PDS}/img/full.jpg`, alt: 'a deer in snow', aspectRatio: { width: 4, height: 3 } }],
  },
  replyCount: 0, repostCount: 0, likeCount: 0, quoteCount: 0,
  indexedAt: '2026-11-05T10:00:01.000Z', viewer: {}, labels: [],
}

interface Pds {
  calls: string[]
  creates: { rkey: string; record: Record<string, unknown> }[]
  deleted: string[]
  failDelete: boolean
  /** The delete is done, but its answer is lost. */
  loseDeleteAnswer: boolean
  /** Gate records at the old post's rkey, by collection (#262). */
  gates: Record<string, unknown>
  gateReads: string[]
  applyWrites: { $type: string; collection: string; rkey: string; value?: Record<string, unknown> }[][]
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

// The timeline and the labeler, through the auth fixture's own PDS hook.
function appview(pds: Pds): XrpcAnswer {
  return (method) => {
    if (method === 'app.bsky.feed.getTimeline') {
      return { body: { feed: pds.deleted.length > 0 ? [] : [{ post: POST_VIEW }] }, headers: COVERED }
    }
    if (method === 'app.bsky.labeler.getServices') {
      return { body: { views: [{
        $type: 'app.bsky.labeler.defs#labelerViewDetailed',
        uri: `at://${BSKY_LABELER}/app.bsky.labeler.service/self`, cid: POST_CID,
        creator: { did: BSKY_LABELER, handle: 'moderation.bsky.app', labels: [] },
        policies: { labelValues: [] }, indexedAt: '2026-01-01T00:00:00.000Z', labels: [],
      }] } }
    }
    return undefined
  }
}

function newPds(): Pds {
  return { calls: [], creates: [], deleted: [], failDelete: false, loseDeleteAnswer: false, gates: {}, gateReads: [], applyWrites: [] }
}

async function fixturePds(page: Page, pds: Pds): Promise<void> {
  const json = (body: unknown, status = 200) => ({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  await page.route(`${PDS}/xrpc/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = url.pathname.replace('/xrpc/', '')
    if (req.method() === 'OPTIONS') return route.fallback()
    switch (method) {
      case 'com.atproto.repo.getRecord': {
        const collection = url.searchParams.get('collection') ?? ''
        const gate = pds.gates[collection]
        if (collection !== 'app.bsky.feed.post') {
          pds.gateReads.push(collection)
          return route.fulfill(gate && url.searchParams.get('rkey') === OLD_RKEY && pds.deleted.length === 0
            ? json({ uri: `at://${ALICE}/${collection}/${OLD_RKEY}`, cid: POST_CID, value: gate })
            : json({ error: 'RecordNotFound', message: 'Could not locate record' }, 400))
        }
        pds.calls.push(`getRecord ${url.searchParams.get('rkey')}`)
        return route.fulfill(url.searchParams.get('rkey') === OLD_RKEY && pds.deleted.length === 0
          ? json({ uri: OLD_URI, cid: POST_CID, value: RECORD })
          : json({ error: 'RecordNotFound', message: 'Could not locate record' }, 400))
      }
      case 'com.atproto.repo.applyWrites': {
        const body = req.postDataJSON() as { repo: string; writes: Pds['applyWrites'][number] }
        pds.calls.push(`applyWrites ${body.writes.map((w) => `${w.$type.split('#')[1]} ${w.collection}`).join(', ')}`)
        pds.applyWrites.push(body.writes)
        if (body.writes[0]!.$type.endsWith('#delete')) pds.deleted.push(body.writes[0]!.rkey)
        else pds.creates.push({ rkey: body.writes[0]!.rkey, record: body.writes[0]!.value! })
        return route.fulfill(json({ results: body.writes.map((w) => w.$type.endsWith('#delete')
          ? { $type: 'com.atproto.repo.applyWrites#deleteResult' }
          : { $type: 'com.atproto.repo.applyWrites#createResult', uri: `at://${body.repo}/${w.collection}/${w.rkey}`, cid: POST_CID }) }))
      }
      case 'com.atproto.sync.getBlob':
        pds.calls.push(`getBlob ${url.searchParams.get('cid')}`)
        return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/octet-stream' }, body: IMAGE_BYTES })
      case 'com.atproto.repo.deleteRecord': {
        const body = req.postDataJSON() as { repo: string; collection: string; rkey: string }
        pds.calls.push(`deleteRecord ${body.repo} ${body.collection} ${body.rkey}`)
        if (pds.failDelete) return route.fulfill(json({ error: 'InternalServerError', message: 'Internal Server Error' }, 500))
        pds.deleted.push(body.rkey)
        if (pds.loseDeleteAnswer) return route.abort('timedout')
        return route.fulfill(json({}))
      }
      case 'com.atproto.repo.uploadBlob':
        pds.calls.push(`uploadBlob ${req.headers()['content-type']}`)
        return route.fulfill(json({ blob: { $type: 'blob', ref: { $link: NEW_CID }, mimeType: 'image/jpeg', size: 100 } }))
      case 'com.atproto.repo.createRecord': {
        const body = req.postDataJSON() as { repo: string; collection: string; rkey: string; record: Record<string, unknown> }
        pds.calls.push('createRecord')
        pds.creates.push({ rkey: body.rkey, record: body.record })
        return route.fulfill(json({ uri: `at://${body.repo}/${body.collection}/${body.rkey}`, cid: POST_CID }))
      }
      case 'app.bsky.feed.getPosts': return route.fulfill(json({ posts: [] }))
      case 'app.bsky.feed.getPostThread':
        return route.fulfill(json({ error: 'NotFound', message: 'Post not found' }, 400))
      default: return route.fallback()
    }
  })
  await page.route(`${PDS}/img/**`, (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/jpeg' }, body: IMAGE_BYTES }))
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

async function chooseRedraft(page: Page) {
  const menu = page.getByRole('button', { name: 'More actions for your post' })
  await expect(menu).toBeVisible({ timeout: 15_000 })
  await menu.click()
  await page.getByRole('menuitem', { name: 'Delete & redraft' }).or(page.getByRole('button', { name: 'Delete & redraft' })).first().click()
  await page.getByRole('dialog', { name: 'Delete and redraft this post?' }).getByRole('button', { name: 'Delete & redraft' }).click()
}

test.describe('Bluesky delete and redraft', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('reads the record and image, deletes, and posts the redraft as a new record', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const pds = newPds()
    await installFixtureAuth(page, { xrpc: appview(pds) })
    await fixturePds(page, pds)
    await signIn(page, origin)
    await chooseRedraft(page)

    const dialog = page.getByRole('dialog', { name: 'New post' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Post text' })).toHaveValue('a deer photo')
    await expect(dialog.getByRole('textbox', { name: /Alt text for/ })).toHaveValue('a deer in snow')
    // Read, then the re-encoded upload, then the delete.
    expect(pds.calls.slice(0, 4)).toEqual([
      `getRecord ${OLD_RKEY}`, `getBlob ${BLOB_CID}`, 'uploadBlob image/jpeg', `deleteRecord ${ALICE} app.bsky.feed.post ${OLD_RKEY}`,
    ])

    await dialog.getByRole('button', { name: 'Post' }).click()
    await expect(dialog).toBeHidden()
    expect(pds.creates).toHaveLength(1)
    expect(pds.creates[0]!.rkey).toMatch(TID)
    expect(pds.creates[0]!.rkey).not.toBe(OLD_RKEY)
    expect(pds.creates[0]!.record).toMatchObject({
      $type: 'app.bsky.feed.post', text: 'a deer photo', langs: ['en'],
      embed: { $type: 'app.bsky.embed.images', images: [{ alt: 'a deer in snow', image: { ref: { $link: NEW_CID } } }] },
    })
  })

  // #262: the limits go with the post, in one write, and come back in the draft.
  test('a post with reply and quote limits: one applyWrites deletes them with it, and the redraft keeps them', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const pds = newPds()
    pds.gates = {
      'app.bsky.feed.threadgate': { $type: 'app.bsky.feed.threadgate', post: OLD_URI, createdAt: RECORD.createdAt, allow: [{ $type: 'app.bsky.feed.threadgate#followingRule' }] },
      'app.bsky.feed.postgate': { $type: 'app.bsky.feed.postgate', post: OLD_URI, createdAt: RECORD.createdAt, embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }] },
    }
    await installFixtureAuth(page, { xrpc: appview(pds) })
    await fixturePds(page, pds)
    await signIn(page, origin)
    await chooseRedraft(page)

    const dialog = page.getByRole('dialog', { name: 'New post' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Only people you follow can reply. Quotes are off.')).toBeVisible()
    // Exactly one delete batch, after two gate reads for the redraft and two for the delete.
    expect(pds.calls.filter((c) => c.startsWith('applyWrites delete'))).toEqual([
      'applyWrites delete app.bsky.feed.post, delete app.bsky.feed.threadgate, delete app.bsky.feed.postgate',
    ])
    expect(pds.calls.some((c) => c.startsWith('deleteRecord'))).toBe(false)
    // The two reads of each pair run at once: their order is not fixed.
    expect([...pds.gateReads].sort()).toEqual(['app.bsky.feed.postgate', 'app.bsky.feed.postgate', 'app.bsky.feed.threadgate', 'app.bsky.feed.threadgate'])

    await dialog.getByRole('button', { name: 'Post' }).click()
    await expect(dialog).toBeHidden()
    const sent = pds.applyWrites.at(-1)!
    expect(sent.map((w) => w.collection)).toEqual(['app.bsky.feed.post', 'app.bsky.feed.threadgate', 'app.bsky.feed.postgate'])
    expect(sent[0]!.rkey).not.toBe(OLD_RKEY)
    // One rkey for all three; each gate names the new post.
    expect(sent.every((w) => w.rkey === sent[0]!.rkey)).toBe(true)
    const newPost = `at://${ALICE}/app.bsky.feed.post/${sent[0]!.rkey}`
    expect(sent[1]!.value).toMatchObject({ post: newPost, allow: [{ $type: 'app.bsky.feed.threadgate#followingRule' }] })
    expect(sent[2]!.value).toMatchObject({ post: newPost, embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }] })
    expect(pds.calls.filter((c) => c.startsWith('applyWrites'))).toHaveLength(2)
  })

  test('a refused delete opens no composer and keeps the post', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const pds = newPds()
    await installFixtureAuth(page, { xrpc: appview(pds) })
    await fixturePds(page, pds)
    pds.failDelete = true
    await signIn(page, origin)
    await chooseRedraft(page)
    await expect(page.getByText('Could not delete this post. Try again.')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'New post' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'More actions for your post' })).toBeVisible()
    // The draft was stored before the delete; the refused delete removed it.
    await page.keyboard.press('Escape')
    const dialog = page.getByRole('dialog', { name: 'New post' })
    await expect(async () => {
      await page.locator('body').click({ position: { x: 1, y: 1 } })
      await page.keyboard.press('n')
      await expect(dialog).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15_000 })
    await expect(dialog.getByRole('textbox', { name: 'Post text' })).toHaveValue('')
  })

  test('a delete whose answer is lost: getRecord says it is gone, and the redraft opens', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const pds = newPds()
    await installFixtureAuth(page, { xrpc: appview(pds) })
    await fixturePds(page, pds)
    pds.loseDeleteAnswer = true
    await signIn(page, origin)
    await chooseRedraft(page)
    const dialog = page.getByRole('dialog', { name: 'New post' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Post text' })).toHaveValue('a deer photo')
    expect(pds.calls).toContain(`getRecord ${OLD_RKEY}`)
    expect(pds.calls.filter((c) => c.startsWith('getRecord'))).toHaveLength(2)
  })
})
