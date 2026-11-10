import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { installFixtureAuth, loopbackOrigin, type XrpcAnswer } from './_bluesky-auth.js'

// A gone labeler (#238; app README, "A gone labeler"). The reader's prefs
// name a labeler that `getServices` has no view for. Every Bluesky card
// stays covered, a notice names the labeler, and Remove asks first. Only a
// yes writes the prefs, and the write changes only that labeler.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bluesky-client/src/__fixtures__')
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>
const BASE_POST = (read('feed-page.json').feed as { post: Record<string, unknown> }[])[0]!.post

const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const GONE = 'did:plc:gonelabeleraaaaaaaaaaaaa'
const POST_URI = 'at://did:plc:bob/app.bsky.feed.post/3kgonelabeler'

const ADULT = { $type: 'app.bsky.actor.defs#adultContentPref', enabled: false }
const SAVED = { $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [{ id: '3kfollowing', type: 'timeline', value: 'following', pinned: true }] }
const labelers = (dids: string[]) => ({ $type: 'app.bsky.actor.defs#labelersPref', labelers: dids.map((did) => ({ did })) })

function pds() {
  let prefs: unknown[] = [ADULT, labelers([GONE]), SAVED]
  const puts: unknown[][] = []
  const answer: XrpcAnswer = (method, url, body) => {
    switch (method) {
      case 'app.bsky.actor.getPreferences':
        return { body: { preferences: prefs } }
      case 'app.bsky.actor.putPreferences':
        prefs = (JSON.parse(body!) as { preferences: unknown[] }).preferences
        puts.push(prefs)
        return { body: {} }
      case 'app.bsky.feed.getTimeline':
        return { body: { feed: [{ post: { ...BASE_POST, uri: POST_URI, cid: CID, $type: 'app.bsky.feed.defs#postView' } }] } }
      // A view only for Bluesky's labeler: the other one is gone.
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
  return { answer, puts }
}

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/`)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${origin}/home`)
}

test.describe('a gone labeler in the reader’s prefs', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('is named; Cancel keeps it; Remove after a yes takes out only it, and the card shows', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const { answer, puts } = pds()
    await installFixtureAuth(page, { xrpc: answer })
    await signIn(page, origin)

    const card = page.locator('page-home caribou-status-card').first()
    await expect(card).toContainText('Checking this post against your moderation settings')
    const notice = page.locator('caribou-gone-labelers .notice')
    // One miss: covered, not offered yet. A Retry is the second miss.
    await expect(notice).toHaveCount(0)
    await card.getByRole('button', { name: 'Retry' }).click()
    await expect(notice).toHaveCount(1)
    await expect(notice).toContainText(GONE)

    // Cancel: nothing is written, the cover stays.
    await notice.getByRole('button', { name: `Remove labeler ${GONE}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove labeler?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    expect(puts).toHaveLength(0)
    await expect(notice).toHaveCount(1)
    await expect(card).toContainText('Checking this post against your moderation settings')

    // Remove: one write, only that labeler out, every other pref as it was.
    await notice.getByRole('button', { name: `Remove labeler ${GONE}` }).click()
    await page.getByRole('dialog', { name: 'Remove labeler?' }).getByRole('button', { name: 'Remove' }).click()
    await expect(notice).toHaveCount(0)
    await expect(page.locator('caribou-gone-labelers .announce')).toHaveText('Labeler removed.')
    expect(puts).toEqual([[ADULT, labelers([]), SAVED]])
    await expect(card).not.toContainText('Checking this post against your moderation settings')
    await expect(card.locator('article')).toBeVisible()
  })
})
