import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { installFixtureAuth, loopbackOrigin, type XrpcAnswer } from './_bluesky-auth.js'

// Signed-in moderation settles (#233). A browser cannot read
// `atproto-content-labelers`: the real AppView and PDS send it but do not
// expose it. So coverage comes from what the request sent in
// `atproto-accept-labelers` (bluesky-client README, "Labeler coverage"),
// and a clean post in Following shows with no cover.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bluesky-client/src/__fixtures__')
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>
const BASE_POST = (read('feed-page.json').feed as { post: Record<string, unknown> }[])[0]!.post

// The SDK checks every answer against the lexicon, so the CID is a real one.
const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const POST_URI = 'at://did:plc:bob/app.bsky.feed.post/3kcoverage'

const answer: XrpcAnswer = (method) => {
  switch (method) {
    case 'app.bsky.feed.getTimeline':
      return {
        body: { feed: [{ post: { ...BASE_POST, uri: POST_URI, cid: CID, $type: 'app.bsky.feed.defs#postView' } }] },
        headers: { 'atproto-content-labelers': `${BSKY_LABELER};redact` },
      }
    // The definitions of Bluesky's labeler: loaded, so the veil can settle.
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

test.describe('Bluesky signed-in moderation settles', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  for (const exposed of [false, true]) {
    test(`a clean post in Following shows with no cover (header ${exposed ? 'exposed' : 'not exposed, as in production'})`, async ({ page, baseURL }) => {
      const origin = loopbackOrigin(baseURL)
      const auth = await installFixtureAuth(page, { xrpc: answer, exposeContentLabelers: exposed })
      await signIn(page, origin)

      const card = page.locator('page-home caribou-status-card').first()
      await expect(card.locator('.actions')).toHaveCount(1)
      await expect(card.locator('article')).toBeVisible()
      await expect(card).not.toContainText('Checking this post against your moderation settings')
      await expect(card.locator('.cover')).toHaveCount(0)

      // The request named Bluesky's labeler: that is what settled it.
      const timeline = auth.pdsCalls.find((c) => c.method === 'app.bsky.feed.getTimeline')
      expect(timeline?.acceptLabelers).toContain(BSKY_LABELER)
    })
  }
})
