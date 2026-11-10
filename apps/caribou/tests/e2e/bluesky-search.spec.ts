import { expect, test, type Page } from '@playwright/test'
import { installFixtureAuth, loopbackOrigin, type XrpcAnswer } from './_bluesky-auth.js'

// Bluesky search and the Bluesky hashtag page (#192, #193; app README,
// "Bluesky search and hashtag page"), through the real SDK and the fixture
// PDS (`_bluesky-auth.ts`). No request leaves the machine.

// The SDK checks every answer against the lexicon, so the CID is a real one.
const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const COVERED = { 'atproto-content-labelers': `${BSKY_LABELER};redact` }

function profile(name: string) {
  return {
    $type: 'app.bsky.actor.defs#profileView', did: `did:plc:${name}`, handle: `${name}.example.com`,
    displayName: name[0]!.toUpperCase() + name.slice(1), labels: [], viewer: {}, indexedAt: '2026-11-01T00:00:00.000Z',
  }
}

// A post with one tag: "hello #cats" (the tag is bytes 6 to 11).
function postView(rkey: string, text = 'hello #cats') {
  return {
    $type: 'app.bsky.feed.defs#postView', uri: `at://did:plc:bob/app.bsky.feed.post/${rkey}`, cid: CID,
    author: { did: 'did:plc:bob', handle: 'bob.example.com', displayName: 'Bob', labels: [] },
    record: {
      $type: 'app.bsky.feed.post', createdAt: '2026-11-05T09:30:00.000Z', text,
      facets: [{ index: { byteStart: 6, byteEnd: 11 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'cats' }] }],
    },
    replyCount: 0, repostCount: 0, likeCount: 0, quoteCount: 0, indexedAt: '2026-11-05T09:30:00.500Z', viewer: {}, labels: [],
  }
}

interface Pds { searches: URL[]; answer: XrpcAnswer }

function fixturePds(): Pds {
  const pds: Pds = {
    searches: [],
    answer: (method, url) => {
      switch (method) {
        case 'app.bsky.actor.searchActors':
          pds.searches.push(url)
          // Page one has a cursor; page two ends the list.
          return url.searchParams.get('cursor')
            ? { body: { actors: [profile('dave')] }, headers: COVERED }
            : { body: { actors: [profile('carol')], cursor: 'A2' }, headers: COVERED }
        case 'app.bsky.feed.searchPosts':
          pds.searches.push(url)
          return { body: { posts: url.searchParams.get('cursor') ? [] : [postView('3kpost1')] }, headers: COVERED }
        case 'app.bsky.actor.getProfiles':
          return { body: { profiles: url.searchParams.getAll('actors').map((d) => ({ ...profile(d.replace('did:plc:', '')), did: d })) }, headers: COVERED }
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
  await page.goto(`${origin}/`)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${origin}/home`)
}

test.describe('Bluesky hashtag page, signed out', () => {
  test('asks the reader to sign in and links to bsky.app', async ({ page }) => {
    await page.goto('/tags/cats?net=bsky')
    const body = page.locator('caribou-bluesky-tag')
    await expect(body.locator('caribou-tag-header h1')).toHaveText('#cats')
    await expect(body.locator('.notice')).toContainText('Sign in with Bluesky to see posts with this tag.')
    await expect(body.getByRole('link', { name: 'See #cats on Bluesky' })).toHaveAttribute('href', 'https://bsky.app/hashtag/cats')
    await expect(page.locator('caribou-timeline')).toHaveCount(0)
  })

  // #251 review: with a Mastodon account active, `/` forwards to Home, so
  // Sign in goes to the add-account page.
  test('Sign in opens the add-account page with a Mastodon account active', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem('caribou.users', JSON.stringify([['alice@example.social', {
        userKey: 'alice@example.social', server: 'example.social', token: 'T', vapidKey: '', createdAt: 1, account: null,
      }]]))
      localStorage.setItem('caribou.activeUserKey', JSON.stringify('alice@example.social'))
    })
    await page.route('https://example.social/**', (route) => route.abort())
    await page.goto('/tags/cats?net=bsky')
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    await page.locator('caribou-bluesky-tag').getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/\?add$/)
    await expect(page.getByRole('tab', { name: 'Bluesky' })).toBeVisible()
  })

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false })
    test('the server sends the notice and the link', async ({ page }) => {
      await page.goto('/tags/cats?net=bsky')
      await expect(page.getByText('Sign in with Bluesky to see posts with this tag.')).toBeVisible()
      await expect(page.getByRole('link', { name: 'See #cats on Bluesky' })).toHaveAttribute('href', 'https://bsky.app/hashtag/cats')
    })
  })
})

test.describe('Bluesky search', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('people and posts, More people, and a tag link to the hashtag page', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const pds = fixturePds()
    await installFixtureAuth(page, { xrpc: pds.answer })
    await signIn(page, origin)

    await page.goto(`${origin}/search?q=cats`)
    const search = page.locator('caribou-search')
    const rows = search.locator('ul.accounts > li')
    await expect(rows).toHaveCount(1)
    await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', '/@carol.example.com')
    await search.getByRole('button', { name: 'More people' }).click()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1).getByRole('link')).toHaveAttribute('href', '/@dave.example.com')
    await expect(search.getByRole('button', { name: 'More people' })).toHaveCount(0)

    await search.getByRole('link', { name: 'Posts' }).click()
    const card = search.locator('caribou-status-card')
    await expect(card).toHaveCount(1)
    await expect(card.locator('.status-content')).toContainText('hello #cats')

    // The tag opens the Bluesky hashtag page in the app.
    await card.locator('.status-content a', { hasText: '#cats' }).click()
    await expect(page).toHaveURL(`${origin}/tags/cats?net=bsky`)
    const timeline = page.locator('caribou-bluesky-tag caribou-timeline')
    await expect(timeline.locator('caribou-status-card')).toHaveCount(1)
    await expect(page.locator('caribou-bluesky-tag .notice')).toHaveCount(0)
    // No Follow: Bluesky cannot follow a tag.
    await expect(page.locator('caribou-tag-header caribou-button.follow')).toHaveCount(0)
    const tagSearch = pds.searches.find((u) => u.searchParams.get('sort') === 'latest')!
    expect(tagSearch.searchParams.get('q')).toBe('#cats')
  })

  // #251 review: `/tags/<tag>` is the Mastodon page; a Bluesky reader goes
  // to the Bluesky one, which keeps its own list.
  test('a Bluesky reader on /tags/<tag> goes to ?net=bsky', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const pds = fixturePds()
    await installFixtureAuth(page, { xrpc: pds.answer })
    await signIn(page, origin)
    await page.goto(`${origin}/tags/cats`)
    await expect(page).toHaveURL(`${origin}/tags/cats?net=bsky`)
    await expect(page.locator('caribou-bluesky-tag caribou-timeline caribou-status-card')).toHaveCount(1)
  })

  test('a 429 says so, with Retry', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const pds = fixturePds()
    await installFixtureAuth(page, {
      xrpc: (method, url, body) => method === 'app.bsky.feed.searchPosts'
        ? { status: 429, body: { error: 'RateLimitExceeded', message: 'Rate Limit Exceeded' } }
        : pds.answer(method, url, body),
    })
    await signIn(page, origin)
    await page.goto(`${origin}/search?q=cats`)
    const alert = page.locator('caribou-search [role="alert"]')
    await expect(alert).toContainText('Bluesky is getting too many requests. Wait a minute, then try again.')
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  })
})
