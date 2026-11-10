import { expect, test, type Page } from '@playwright/test'
import { ALICE, installFixtureAuth, loopbackOrigin, type XrpcAnswer } from './_bluesky-auth.js'

// A Bluesky video in a real browser (#198; app README, "Bluesky video").
// The timeline answers one post with a video. The playlist host answers
// 404, so the test never reaches video.bsky.app and sees rule 6's error.

const POST_URI = `at://${ALICE}/app.bsky.feed.post/3lalicevideo`
const CID = 'bafyreib7upx3s2pfhghouqwntlb4vsokgkwi7kmeqfsyddvum2xle33riq'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const COVERED = { 'atproto-content-labelers': `${BSKY_LABELER};redact` }
const VIDEO_HOST = 'https://video.bsky.app'
const PLAYLIST = `${VIDEO_HOST}/watch/${encodeURIComponent(ALICE)}/bafkvideo/playlist.m3u8`
// A 1×1 PNG for the thumbnail.
const THUMB_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const POST_VIEW = {
  $type: 'app.bsky.feed.defs#postView',
  uri: POST_URI, cid: CID,
  author: { did: ALICE, handle: 'alice.example.com', displayName: 'Alice', labels: [] },
  record: { $type: 'app.bsky.feed.post', text: 'a caribou video', createdAt: '2026-11-05T10:00:00.000Z' },
  embed: {
    $type: 'app.bsky.embed.video#view',
    cid: 'bafkreidlp6sdj6jkroakvmbntpy2clsj77foijheae5byt3iwz7d2k542a',
    playlist: PLAYLIST,
    thumbnail: `${VIDEO_HOST}/watch/${encodeURIComponent(ALICE)}/bafkvideo/thumbnail.jpg`,
    alt: 'A caribou running',
    aspectRatio: { width: 16, height: 9 },
  },
  replyCount: 0, repostCount: 0, likeCount: 0, quoteCount: 0,
  indexedAt: '2026-11-05T10:00:01.000Z', viewer: {}, labels: [],
}

const appview: XrpcAnswer = (method) => {
  if (method === 'app.bsky.feed.getTimeline') return { body: { feed: [{ post: POST_VIEW }] }, headers: COVERED }
  if (method === 'app.bsky.labeler.getServices') {
    return { body: { views: [{
      $type: 'app.bsky.labeler.defs#labelerViewDetailed',
      uri: `at://${BSKY_LABELER}/app.bsky.labeler.service/self`, cid: CID,
      creator: { did: BSKY_LABELER, handle: 'moderation.bsky.app', labels: [] },
      policies: { labelValues: [] }, indexedAt: '2026-01-01T00:00:00.000Z', labels: [],
    }] } }
  }
  return undefined
}

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/`)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${origin}/home`)
}

test.describe('Bluesky video', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('rules 1, 4 and 6: nothing loads before play; a failed stream says so and links to bsky.app', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const playlistAsked: string[] = []
    const hlsChunk: string[] = []
    page.on('request', (req) => { if (/\/hls-[^/]*\.js$/.test(req.url())) hlsChunk.push(req.url()) })
    await page.route(`${VIDEO_HOST}/**`, (route) => {
      const url = route.request().url()
      if (url.endsWith('.jpg')) return route.fulfill({ status: 200, contentType: 'image/png', body: THUMB_BYTES })
      playlistAsked.push(url)
      return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'not found' })
    })
    await installFixtureAuth(page, { xrpc: appview })
    await signIn(page, origin)

    const play = page.getByRole('link', { name: 'Play video: A caribou running' })
    await expect(play).toBeVisible({ timeout: 15_000 })
    await page.waitForLoadState('networkidle')
    // Rule 1: the thumbnail only.
    expect(playlistAsked).toEqual([])
    expect(hlsChunk).toEqual([])
    // Rule 2: without JavaScript the thumbnail opens the post on bsky.app.
    await expect(play).toHaveAttribute('href', `https://bsky.app/profile/${ALICE}/post/3lalicevideo`)

    await play.click()
    const alert = page.getByRole('alert').filter({ hasText: 'This video could not play.' })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert.getByRole('link', { name: 'Watch on bsky.app' }))
      .toHaveAttribute('href', `https://bsky.app/profile/${ALICE}/post/3lalicevideo`)
    expect(playlistAsked).toContain(PLAYLIST)
    // Rules 3 and 4: a browser with native HLS never loads hls.js; any other
    // loads it once, on the press. (Newer Chromium plays HLS natively.)
    const native = await page.evaluate(() => document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '')
    expect(hlsChunk).toHaveLength(native ? 0 : 1)
  })

  test('rule 4: without native HLS, hls.js loads once, on the press, and a fatal error shows rule 6', async ({ page, baseURL }) => {
    // As in a browser with no native HLS (Firefox, older Chromium).
    await page.addInitScript(() => {
      const real = HTMLMediaElement.prototype.canPlayType
      HTMLMediaElement.prototype.canPlayType = function (type: string) {
        return /mpegurl/i.test(type) ? '' : real.call(this, type)
      }
    })
    const origin = loopbackOrigin(baseURL)
    const hlsChunk: string[] = []
    const playlistAsked: string[] = []
    page.on('request', (req) => { if (/\/hls-[^/]*\.js$/.test(req.url())) hlsChunk.push(req.url()) })
    await page.route(`${VIDEO_HOST}/**`, (route) => {
      const url = route.request().url()
      if (url.endsWith('.jpg')) return route.fulfill({ status: 200, contentType: 'image/png', body: THUMB_BYTES })
      playlistAsked.push(url)
      return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'not found' })
    })
    await installFixtureAuth(page, { xrpc: appview })
    await signIn(page, origin)
    const play = page.getByRole('link', { name: 'Play video: A caribou running' })
    await expect(play).toBeVisible({ timeout: 15_000 })
    await page.waitForLoadState('networkidle')
    expect(hlsChunk).toEqual([])
    await play.click()
    await expect(page.getByRole('alert').filter({ hasText: 'This video could not play.' })).toBeVisible({ timeout: 15_000 })
    expect(hlsChunk).toHaveLength(1)
    expect(playlistAsked).toContain(PLAYLIST)
  })
})
