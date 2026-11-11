import { expect, test, type Page } from '@playwright/test'
import { ALICE, BOB, installFixtureAuth, loopbackOrigin, type XrpcAnswer, waitForSignedInHome } from './_bluesky-auth.js'

// A signed-in reader clicks a post's time on a Home card (#271). The link
// is `/@<handle>/<rkey>`. The AppView answers `getPosts` with a 500 for a
// handle in the URI (it accepts one in `getPostThread`), so the thread must
// read the post by its DID URI (app README, "Bluesky views").

const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const COVERED = { 'atproto-content-labelers': `${BSKY_LABELER};redact` }
const RKEY = '3lhandlepost'
const POST = `at://${BOB}/app.bsky.feed.post/${RKEY}`
const BOB_AUTHOR = { did: BOB, handle: 'bob.example.com', displayName: 'Bob', labels: [] }

function postView(uri: string) {
  return {
    $type: 'app.bsky.feed.defs#postView',
    uri, cid: CID, author: BOB_AUTHOR,
    record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-05T09:30:00.000Z', text: 'a post by handle' },
    replyCount: 0, repostCount: 0, likeCount: 0, quoteCount: 0,
    indexedAt: '2026-11-05T09:30:00.500Z', viewer: {}, labels: [],
  }
}

interface Pds { getPosts: string[][]; answer: XrpcAnswer }

function fixturePds(): Pds {
  const pds: Pds = {
    getPosts: [],
    answer: (method, url) => {
      switch (method) {
        case 'app.bsky.feed.getTimeline':
          return { body: url.searchParams.get('cursor') ? { feed: [] } : { feed: [{ post: postView(POST) }] }, headers: COVERED }
        case 'app.bsky.feed.getPosts': {
          const uris = url.searchParams.getAll('uris')
          pds.getPosts.push(uris)
          // As the real AppView does for a handle in the URI.
          if (uris.some((u) => !u.startsWith('at://did:'))) {
            return { status: 500, body: { error: 'InternalServerError', message: 'Internal Server Error' } }
          }
          return { body: { posts: uris.map(postView) }, headers: COVERED }
        }
        case 'app.bsky.feed.getPostThread':
          return { body: { thread: { $type: 'app.bsky.feed.defs#threadViewPost', post: postView(POST), replies: [] } }, headers: COVERED }
        case 'app.bsky.actor.getProfile': {
          const actor = url.searchParams.get('actor')
          if (actor !== 'bob.example.com' && actor !== BOB) return undefined
          return { body: { ...BOB_AUTHOR, description: '', followersCount: 0, followsCount: 0, postsCount: 1 }, headers: COVERED }
        }
        case 'app.bsky.labeler.getServices':
          return { body: { views: [{
            $type: 'app.bsky.labeler.defs#labelerViewDetailed',
            uri: `at://${BSKY_LABELER}/app.bsky.labeler.service/self`, cid: CID,
            creator: { did: BSKY_LABELER, handle: 'moderation.bsky.app', labels: [] },
            policies: { labelValues: [] }, indexedAt: '2026-01-01T00:00:00.000Z', labels: [],
          }] } }
        case 'app.bsky.notification.getUnreadCount':
          return { body: { count: 0 } }
        default:
          return undefined
      }
    },
  }
  return pds
}

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/`)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await waitForSignedInHome(page, origin)
}

test.describe('a Bluesky post opened by its handle address, signed in (#271)', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('the time link on a Home card opens the thread; getPosts gets only DID URIs', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const pds = fixturePds()
    await installFixtureAuth(page, { sub: ALICE, xrpc: pds.answer })
    // The page data the router asks the server for. The server would read
    // the public AppView, which CI must not reach: answer as the server
    // does when that read fails.
    await page.route(`${origin}/@bob.example.com/${RKEY}`, (route) => {
      if (!route.request().headers()['accept']?.includes('application/json')) return route.fallback()
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ kind: 'error', message: 'AppView unreachable', shell: { instance: null }, statusId: RKEY, handle: 'bob.example.com' }),
      })
    })
    await signIn(page, origin)

    const card = page.locator('page-home caribou-status-card').filter({ hasText: 'a post by handle' })
    await card.locator('litro-link.permalink time').click()
    await page.waitForURL(`${origin}/@bob.example.com/${RKEY}`)

    const thread = page.locator('page-handle-statusid caribou-thread')
    await expect(thread).toHaveAttribute('statusid', POST)
    await expect(thread.locator('caribou-status-card').filter({ hasText: 'a post by handle' })).toBeVisible()
    await expect(page.locator('page-handle-statusid [role=alert]')).toHaveCount(0)
    expect(pds.getPosts.length).toBeGreaterThan(0)
    expect(pds.getPosts.flat().every((u) => u.startsWith('at://did:'))).toBe(true)
  })
})
