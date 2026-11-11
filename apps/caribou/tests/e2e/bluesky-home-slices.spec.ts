import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { ALICE, installFixtureAuth, loopbackOrigin, type XrpcAnswer, waitForSignedInHome } from './_bluesky-auth.js'

// Bluesky Home as bsky.app's Following feed (#275; app README, "Bluesky
// views", "Home shows threads as slices"; bluesky-client README, "Home").
// With the default feed prefs: a reply shows under its parent and root, a
// reply to an unfollowed author does not show, and a thread shows once.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bluesky-client/src/__fixtures__')
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>
const BASE_POST = (read('feed-page.json').feed as { post: Record<string, unknown> }[])[0]!.post

// The reader is the fixture sign-in's account.
const READER = ALICE
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'

function author(name: string, followed: boolean) {
  return {
    did: `did:plc:${name}`, handle: `${name}.example.com`, displayName: name, labels: [],
    viewer: followed ? { following: `at://${READER}/app.bsky.graph.follow/${name}` } : {},
  }
}
const dana = author('dana', true)
const carol = author('carol', true)
const erin = author('erin', false)

type Who = typeof dana
const ref = (p: { uri: string; cid: string }) => ({ uri: p.uri, cid: p.cid })

function post(who: Who, rkey: string, text: string, reply?: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } }) {
  return {
    ...BASE_POST,
    $type: 'app.bsky.feed.defs#postView',
    uri: `at://${who.did}/app.bsky.feed.post/${rkey}`, cid: CID,
    author: who,
    record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-10T10:00:00.000Z', text, ...(reply ? { reply: { root: ref(reply.root), parent: ref(reply.parent) } } : {}) },
  }
}

const root = post(dana, '3kroot', 'the root of the thread')
const middle = post(carol, '3kmiddle', 'the parent reply', { root, parent: root })
const answer = post(dana, '3kanswer', 'the newest reply', { root, parent: middle })
const older = post(carol, '3kolder', 'an older reply in the same thread', { root, parent: root })
const erinPost = post(erin, '3kerin', 'a post by someone the reader does not follow')
const toErin = post(dana, '3ktoerin', 'a reply to someone the reader does not follow', { root: erinPost, parent: erinPost })
const plain = post(carol, '3kplain', 'a plain post')

const FEED = [
  { post: answer, reply: { root, parent: middle, grandparentAuthor: dana } },
  { post: toErin, reply: { root: erinPost, parent: erinPost } },
  { post: older, reply: { root, parent: root } },
  { post: plain },
]

const xrpc: XrpcAnswer = (method, url) => {
  switch (method) {
    case 'app.bsky.actor.getPreferences':
      return { body: { preferences: [] } }
    case 'app.bsky.feed.getTimeline':
      return { body: { feed: FEED } }
    case 'app.bsky.graph.getMutes':
    case 'app.bsky.graph.getBlocks':
      return { body: { [method.endsWith('Mutes') ? 'mutes' : 'blocks']: [] } }
    case 'app.bsky.labeler.getServices':
      return { body: { views: url.searchParams.getAll('dids').filter((d) => d === BSKY_LABELER).map((did) => ({
        $type: 'app.bsky.labeler.defs#labelerViewDetailed',
        uri: `at://${did}/app.bsky.labeler.service/self`, cid: CID,
        creator: { did, handle: 'moderation.bsky.app', labels: [] },
        policies: { labelValues: [] }, indexedAt: '2026-01-01T00:00:00.000Z', labels: [],
      })) } }
    default:
      return undefined
  }
}

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/`)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await waitForSignedInHome(page, origin)
}

test.describe('Bluesky Home slices', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('a reply under its parent and root; no reply to an unfollowed author; a thread once', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    await installFixtureAuth(page, { xrpc })
    await signIn(page, origin)

    const home = page.locator('page-home caribou-timeline')
    await expect(home.getByText('a plain post')).toBeVisible()
    const items = home.locator('ul > li')
    await expect(items).toHaveCount(2)

    // One slice: root, parent, then the reply, each its own article, in order.
    const slice = items.first()
    const articles = slice.getByRole('article')
    await expect(articles).toHaveCount(3)
    await expect(articles.nth(0)).toContainText('the root of the thread')
    await expect(articles.nth(1)).toContainText('the parent reply')
    await expect(articles.nth(2)).toContainText('the newest reply')
    // Each time link opens its own post's thread.
    const timeLinks = slice.locator('caribou-status-card').locator('.permalink')
    await expect(timeLinks).toHaveCount(3)
    for (const [i, rkey] of [[0, '3kroot'], [1, '3kmiddle'], [2, '3kanswer']] as const) {
      await expect(timeLinks.nth(i)).toHaveAttribute('href', new RegExp(`${rkey}$`))
    }

    await expect(home.getByText('a reply to someone the reader does not follow')).toHaveCount(0)
    await expect(home.getByText('an older reply in the same thread')).toHaveCount(0)
  })
})
