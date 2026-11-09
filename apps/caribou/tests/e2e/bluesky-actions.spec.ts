import { expect, test, type Page } from '@playwright/test'
import { ALICE, BOB, installFixtureAuth, loopbackOrigin, type XrpcAnswer } from './_bluesky-auth.js'

// Bluesky card actions through the real SDK and the fixture PDS (#188):
// a like writes one like record and its undo deletes exactly that record;
// a post whose author limited replies has Reply off and opens no composer;
// the block confirm says blocks on Bluesky are public.

// The SDK checks every answer against the lexicon, so the CIDs are real ones.
const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const COVERED = { 'atproto-content-labelers': `${BSKY_LABELER};redact` }
const OPEN = `at://${BOB}/app.bsky.feed.post/3lopenpost1`
const LIMITED = `at://${BOB}/app.bsky.feed.post/3llimited01`

function postView(uri: string, text: string, viewer: Record<string, unknown> = {}) {
  return {
    $type: 'app.bsky.feed.defs#postView',
    uri, cid: CID,
    author: { did: BOB, handle: 'bob.example.com', displayName: 'Bob', labels: [] },
    record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-05T09:30:00.000Z', text },
    replyCount: 0, repostCount: 0, likeCount: 2, quoteCount: 0,
    indexedAt: '2026-11-05T09:30:00.500Z', viewer, labels: [],
  }
}

function mention(uri: string, text: string) {
  return {
    uri, cid: CID, reason: 'mention', isRead: true, indexedAt: '2026-11-05T09:30:00.500Z', labels: [],
    author: { did: BOB, handle: 'bob.example.com', displayName: 'Bob', labels: [] },
    record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-05T09:30:00.000Z', text },
  }
}

interface Pds {
  creates: { collection: string; record: Record<string, unknown> }[]
  deletes: { repo: string; collection: string; rkey: string }[]
  answer: XrpcAnswer
}

function fixturePds(): Pds {
  let n = 0
  const pds: Pds = {
    creates: [],
    deletes: [],
    answer: (method, url, body) => {
      switch (method) {
        // Home's reads do not carry labeler coverage yet (#233), so the
        // cards are tested where they do: two mentions on /notifications.
        case 'app.bsky.notification.listNotifications':
          return { body: url.searchParams.get('cursor') ? { notifications: [] } : { notifications: [
            mention(OPEN, 'open post'), mention(LIMITED, 'limited post'),
          ] }, headers: COVERED }
        case 'app.bsky.notification.getUnreadCount':
          return { body: { count: 0 } }
        case 'app.bsky.notification.updateSeen':
          return { body: {} }
        case 'app.bsky.feed.getPosts':
          return { body: { posts: url.searchParams.getAll('uris').map((uri) => uri === LIMITED
            ? postView(uri, 'limited post', { replyDisabled: true })
            : postView(uri, 'open post')) }, headers: COVERED }
        case 'com.atproto.repo.createRecord': {
          const b = JSON.parse(body ?? '{}') as { repo: string; collection: string; record: Record<string, unknown> }
          pds.creates.push({ collection: b.collection, record: b.record })
          return { body: { uri: `at://${b.repo}/${b.collection}/3lnewrec${++n}aa`, cid: CID } }
        }
        case 'com.atproto.repo.deleteRecord':
          pds.deletes.push(JSON.parse(body ?? '{}'))
          return { body: {} }
        case 'app.bsky.labeler.getServices':
          return { body: { views: [{
            $type: 'app.bsky.labeler.defs#labelerViewDetailed',
            uri: `at://${BSKY_LABELER}/app.bsky.labeler.service/self`, cid: CID,
            creator: { did: BSKY_LABELER, handle: 'moderation.bsky.app', labels: [] },
            policies: { labelValues: [] }, indexedAt: '2026-01-01T00:00:00.000Z', labels: [],
          }] } }
        default:
          return undefined
      }
    },
  }
  return pds
}

async function signIn(page: Page, origin: string) {
  await page.addInitScript(() => localStorage.setItem('caribou.flag.bluesky', '1'))
  await page.goto(`${origin}/`)
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${origin}/home`)
  await page.getByRole('link', { name: 'Notifications' }).click()
  await page.waitForURL(`${origin}/notifications`)
}

const card = (page: Page, text: string) => page.locator('caribou-status-card').filter({ hasText: text })

test.describe('Bluesky card actions', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('a like writes one like record; its undo deletes exactly that record', async ({ page, baseURL }) => {
    const pds = fixturePds()
    await installFixtureAuth(page, { xrpc: pds.answer })
    await signIn(page, loopbackOrigin(baseURL))
    const open = card(page, 'open post')
    const like = open.getByRole('button', { name: 'Favourite' })
    await expect(like).toBeVisible()
    await expect(like).not.toHaveAttribute('aria-disabled', 'true')
    await like.click()
    const unlike = open.getByRole('button', { name: 'Unfavourite' })
    await expect(unlike).toHaveAttribute('aria-pressed', 'true')
    await expect(unlike).toContainText('3')
    await expect.poll(() => pds.creates.length).toBe(1)
    expect(pds.creates[0]).toMatchObject({
      collection: 'app.bsky.feed.like',
      record: { $type: 'app.bsky.feed.like', subject: { uri: OPEN, cid: CID } },
    })
    await unlike.click()
    await expect(open.getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => pds.deletes).toEqual([{ repo: ALICE, collection: 'app.bsky.feed.like', rkey: '3lnewrec1aa' }])
    expect(pds.creates).toHaveLength(1)
  })

  test('Reply is off with a reason on a post whose author limited replies', async ({ page, baseURL }) => {
    const pds = fixturePds()
    await installFixtureAuth(page, { xrpc: pds.answer })
    await signIn(page, loopbackOrigin(baseURL))
    const limited = card(page, 'limited post').getByRole('button', { name: 'Reply' })
    await expect(limited).toHaveAttribute('aria-disabled', 'true')
    await expect(limited).toHaveAttribute('title', 'The author limited replies')
    await limited.click({ force: true })
    await expect(page.getByRole('dialog', { name: 'Reply' })).toHaveCount(0)
    // The open post replies and quotes as usual.
    await card(page, 'open post').getByRole('button', { name: 'Quote' }).click()
    await expect(page.getByRole('dialog', { name: 'Quote post' })).toBeVisible()
  })

  test('the block confirm says blocks on Bluesky are public', async ({ page, baseURL }) => {
    const pds = fixturePds()
    await installFixtureAuth(page, { xrpc: pds.answer })
    await signIn(page, loopbackOrigin(baseURL))
    const open = card(page, 'open post')
    await open.getByRole('button', { name: /More actions for post by/ }).click()
    await open.locator('[data-action="block"]').click()
    const dialog = page.getByRole('dialog', { name: 'Block @bob.example.com?' })
    await expect(dialog).toContainText('Blocks on Bluesky are public.')
    await dialog.getByRole('button', { name: 'Block' }).click()
    await expect.poll(() => pds.creates.map((c) => c.collection)).toEqual(['app.bsky.graph.block'])
    expect(pds.creates[0]!.record).toMatchObject({ subject: BOB })
  })
})
