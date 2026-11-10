import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { installFixtureAuth, loopbackOrigin, type XrpcAnswer } from './_bluesky-auth.js'

// Bluesky muted words (#196; app README, "Bluesky muted words"). The
// filters screen lists and edits them; a write changes only the muted-words
// pref; the words apply with no page reload.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bluesky-client/src/__fixtures__')
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>
const BASE_POST = (read('feed-page.json').feed as { post: Record<string, unknown> }[])[0]!.post

const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const POST_URI = 'at://did:plc:bob/app.bsky.feed.post/3kmutedword'

const ADULT = { $type: 'app.bsky.actor.defs#adultContentPref', enabled: false }
const SAVED = { $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [{ id: '3kfollowing', type: 'timeline', value: 'following', pinned: true }] }
// A pref type Caribou does not know: a write must keep it as it is.
const UNKNOWN = { $type: 'app.example.futurePref', keep: { deep: [1, 2] } }
const OLD = { id: '3kold', value: 'finale', targets: ['tag'], actorTarget: 'all', expiresAt: '2020-01-01T00:00:00.000Z' }
const muted = (items: unknown[]) => ({ $type: 'app.bsky.actor.defs#mutedWordsPref', items })

function pds() {
  let prefs: unknown[] = [ADULT, muted([OLD]), UNKNOWN, SAVED]
  const puts: unknown[][] = []
  const reads = { timeline: 0 }
  const answer: XrpcAnswer = (method, url, body) => {
    switch (method) {
      case 'app.bsky.actor.getPreferences':
        return { body: { preferences: prefs } }
      case 'app.bsky.actor.putPreferences':
        prefs = (JSON.parse(body!) as { preferences: unknown[] }).preferences
        puts.push(prefs)
        return { body: {} }
      case 'app.bsky.feed.getTimeline':
        reads.timeline++
        return { body: { feed: [{ post: { ...BASE_POST, uri: POST_URI, cid: CID, $type: 'app.bsky.feed.defs#postView' } }] } }
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
  return { answer, puts, reads }
}

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/`)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${origin}/home`)
}

// An in-app move, as a link click makes it: no page load.
async function spaGo(page: Page, path: string) {
  await page.evaluate((p) => {
    history.pushState({}, '', p)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

test.describe('Bluesky muted words', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('are listed and added; the write keeps every other pref; the word applies with no reload', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const { answer, puts, reads } = pds()
    await installFixtureAuth(page, { xrpc: answer })
    await signIn(page, origin)

    const home = page.locator('page-home caribou-timeline')
    await expect(home.getByText('plain post')).toBeVisible()
    // Set once; a page load would drop it.
    await page.evaluate(() => { (window as unknown as { noReload: boolean }).noReload = true })

    await spaGo(page, '/settings/moderation')
    const words = page.locator('caribou-muted-words')
    await expect(page.getByRole('heading', { name: 'Muted words' })).toBeVisible()
    // The expired word is listed, marked.
    await expect(words.locator('li.word')).toHaveCount(1)
    await expect(words.locator('li.word')).toContainText('finale')
    await expect(words.locator('li.word')).toContainText('Expired')

    await words.getByLabel('Word or phrase').fill('plain')
    await words.getByRole('button', { name: 'Mute', exact: true }).click()
    await expect(words.locator('li.word')).toHaveCount(2)
    await expect(words.locator('.announce')).toHaveText('Muted “plain”.')

    // One write: only the muted-words pref changed; the expired word stays.
    expect(puts).toHaveLength(1)
    const [adult, mw, unknown, saved] = puts[0]! as Record<string, unknown>[]
    expect([adult, unknown, saved]).toEqual([ADULT, UNKNOWN, SAVED])
    expect((mw!.items as Record<string, unknown>[])[0]).toEqual(OLD)
    expect((mw!.items as Record<string, unknown>[])[1]).toMatchObject({ value: 'plain', targets: ['content', 'tag'], actorTarget: 'all' })

    // Back to Home in the app: the post is hidden now, with no page load.
    const before = reads.timeline
    await page.locator('caribou-nav-rail a[href="/home"]').first().click()
    await page.waitForURL(`${origin}/home`)
    // The kept page was emptied, so Home reads again, as the reader.
    await expect.poll(() => reads.timeline).toBeGreaterThan(before)
    // A muted word hides a list card: it renders nothing.
    const card = page.locator('page-home caribou-timeline caribou-status-card')
    await expect(card).toHaveCount(1)
    await expect(card.locator('article')).toHaveCount(0)
    await expect(page.locator('page-home caribou-timeline').getByText('plain post')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true)

    // Remove: the word goes, one more write.
    await spaGo(page, '/settings/moderation')
    // By keyboard: focus moves to the row before, as the row goes.
    await words.getByRole('button', { name: 'Remove muted word plain' }).focus()
    await page.keyboard.press('Enter')
    await expect(words.locator('li.word')).toHaveCount(1)
    await expect(words.getByRole('button', { name: 'Remove muted word finale' })).toBeFocused()
    expect(puts).toHaveLength(2)
    expect((puts[1]![1] as { items: unknown[] }).items).toEqual([OLD])
  })
})
