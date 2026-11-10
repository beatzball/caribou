import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { installFixtureAuth, loopbackOrigin, type FixtureAuth, type XrpcAnswer, waitForSignedInHome } from './_bluesky-auth.js'

// Bluesky feeds (#194; README, "Bluesky feeds") through the real SDK and the
// fixture PDS: Home's tabs from the reader's pinned feeds, a feed's posts in
// its tab, a gone feed and a failing feed in their tabs, the Feeds page, and
// no write to the reader's prefs.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bluesky-client/src/__fixtures__')
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>
const BASE_POST = (read('feed-page.json').feed as { post: Record<string, unknown> }[])[0]!.post

// The SDK checks every answer against the lexicon, so the CID is a real one.
const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const COVERED = { 'atproto-content-labelers': `${BSKY_LABELER};redact` }

const FEED_HOST = 'did:plc:feedsaaaaaaaaaaaaaaaaaaa'
const CATS = `at://${FEED_HOST}/app.bsky.feed.generator/cats`
const DOGS = `at://${FEED_HOST}/app.bsky.feed.generator/dogs`
const GONE = `at://${FEED_HOST}/app.bsky.feed.generator/gone`
const BROKEN = `at://${FEED_HOST}/app.bsky.feed.generator/broken`

function postView(rkey: string, text: string) {
  const record = { ...(BASE_POST.record as Record<string, unknown>), text }
  return { ...BASE_POST, uri: `at://${FEED_HOST}/app.bsky.feed.post/${rkey}`, cid: CID, record, $type: 'app.bsky.feed.defs#postView' }
}

function generator(uri: string, name: string) {
  return {
    uri, cid: CID, did: 'did:web:feeds.example.com', displayName: name, description: `Only ${name.toLowerCase()}`,
    creator: { did: FEED_HOST, handle: 'feeds.example.com' }, indexedAt: '2026-01-01T00:00:00.000Z',
  }
}

const SAVED = [
  { id: 'a', type: 'timeline', value: 'following', pinned: true },
  { id: 'b', type: 'feed', value: CATS, pinned: true },
  { id: 'c', type: 'feed', value: GONE, pinned: true },
  { id: 'd', type: 'feed', value: BROKEN, pinned: true },
  { id: 'e', type: 'feed', value: DOGS, pinned: false },
]

const answer: XrpcAnswer = (method, url) => {
  switch (method) {
    case 'app.bsky.actor.getPreferences':
      return { body: { preferences: [{ $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: SAVED }] } }
    case 'app.bsky.feed.getFeedGenerators': {
      const names: Record<string, string> = { [CATS]: 'Cats', [DOGS]: 'Dogs', [BROKEN]: 'Broken' }
      return { body: { feeds: url.searchParams.getAll('feeds').filter((f) => names[f]).map((f) => generator(f, names[f]!)) } }
    }
    case 'app.bsky.feed.getTimeline':
      // Long enough to scroll.
      return { body: { feed: Array.from({ length: 30 }, (_, i) => ({ post: postView(`home${i}`, `a post from Following ${i}`) })) }, headers: COVERED }
    case 'app.bsky.feed.getFeed': {
      const feed = url.searchParams.get('feed')
      if (feed === CATS) return { body: { feed: [{ post: postView('cat1', 'a cat post') }] }, headers: COVERED }
      if (feed === DOGS) return { body: { feed: [{ post: postView('dog1', 'a dog post') }] }, headers: COVERED }
      if (feed === GONE) return { status: 400, body: { error: 'UnknownFeed', message: 'Unknown feed' } }
      return { status: 502, body: { error: 'UpstreamFailure', message: 'feed unavailable' } }
    }
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
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await waitForSignedInHome(page, origin)
}

const feedHref = (uri: string) => `/home?feed=${encodeURIComponent(uri)}`
const shown = (page: Page) => page.locator('litro-outlet > page-home:not([hidden])')

test.describe('Bluesky feeds', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  let auth: FixtureAuth

  test.beforeEach(async ({ page, baseURL }) => {
    auth = await installFixtureAuth(page, { xrpc: answer })
    await signIn(page, loopbackOrigin(baseURL))
  })

  test('Home tabs: Following first, then the pinned feeds; a tab shows its feed', async ({ page }) => {
    const tabs = shown(page).locator('caribou-feed-tabs caribou-tabs a')
    await expect(tabs).toHaveText(['Following', 'Cats', 'gone', 'Broken'])
    await expect(tabs.first()).toHaveAttribute('aria-current', 'page')
    await expect(shown(page).locator('caribou-status-card')).toHaveCount(30)

    // Wait for the scroll event: the router records the position in its own
    // listener (page-cache.spec.ts).
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.addEventListener('scroll', () => resolve(), { once: true })
      window.scrollTo(0, 1200)
    }))
    // A real click would first scroll the tab into view.
    await tabs.nth(1).dispatchEvent('click', { button: 0 })
    await expect(page).toHaveURL((u) => u.pathname + u.search === feedHref(CATS))
    const cats = shown(page).locator('caribou-feed-tabs caribou-tabs a[aria-current="page"]')
    await expect(cats).toHaveText('Cats')
    await expect(shown(page).locator('caribou-status-card')).toContainText('a cat post')

    // A tab click starts at the top. Back is Following again, at its place.
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.goBack()
    await expect(shown(page).locator('caribou-status-card')).toHaveCount(30)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200)
  })

  test('a gone feed and a failing feed say so in their tabs', async ({ page }) => {
    const tabs = shown(page).locator('caribou-feed-tabs caribou-tabs a')
    await tabs.filter({ hasText: 'gone' }).click()
    await expect(shown(page).locator('caribou-feed-tabs')).toContainText('This feed is gone. Its owner may have deleted it.')

    await shown(page).locator('caribou-feed-tabs caribou-tabs a').filter({ hasText: 'Broken' }).click()
    await expect(shown(page).locator('caribou-timeline [role="alert"]')).toHaveText('This feed did not load. Try again later.')
    await expect(shown(page).locator('caribou-timeline').getByRole('button', { name: 'Retry' })).toBeVisible()
  })

  test('the Feeds page lists the saved feeds and opens one as a Home tab; nothing writes prefs', async ({ page }) => {
    const rail = shown(page).locator('caribou-nav-rail')
    await rail.locator('a[href="/feeds"]').first().dispatchEvent('click', { button: 0 })
    await expect(page).toHaveURL(/\/feeds$/)
    const rows = page.locator('page-feeds caribou-feeds li')
    await expect(rows).toHaveCount(5)
    await expect(rows.locator('.name')).toHaveText(['Following', 'Cats', 'gone', 'Broken', 'Dogs'])
    await expect(rows.nth(2)).toContainText('Not available')
    await expect(rows.nth(1)).toContainText('Pinned')
    await expect(rows.nth(4)).not.toContainText('Pinned')

    await rows.nth(4).getByRole('link', { name: 'Dogs' }).click()
    await expect(page).toHaveURL((u) => u.pathname + u.search === feedHref(DOGS))
    // Not pinned: its tab is added at the end while it is open.
    const current = shown(page).locator('caribou-feed-tabs caribou-tabs a[aria-current="page"]')
    await expect(current).toHaveText('Dogs')
    await expect(shown(page).locator('caribou-status-card')).toContainText('a dog post')

    expect(auth.pdsCalls.map((c) => c.method)).not.toContain('app.bsky.actor.putPreferences')
  })
})
