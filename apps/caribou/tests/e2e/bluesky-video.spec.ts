import { expect, test, type Page } from '@playwright/test'
import { ALICE, installFixtureAuth, loopbackOrigin, type XrpcAnswer, waitForSignedInHome } from './_bluesky-auth.js'
import { brokenNativeHls, forceHlsJs, noNewTab, routeHlsFixture, THUMB_BYTES } from './_hls-fixture.js'

// A Bluesky video in a real browser (#198; app README, "Bluesky video").
// The timeline answers one post with a video. The test never reaches
// video.bsky.app: the first two tests answer 404 there and see rule 6's
// error; the playback tests get the stream in `fixtures/hls/` and see it play.

const POST_URI = `at://${ALICE}/app.bsky.feed.post/3lalicevideo`
const CID = 'bafyreib7upx3s2pfhghouqwntlb4vsokgkwi7kmeqfsyddvum2xle33riq'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const COVERED = { 'atproto-content-labelers': `${BSKY_LABELER};redact` }
const VIDEO_HOST = 'https://video.bsky.app'
const PLAYLIST = `${VIDEO_HOST}/watch/${encodeURIComponent(ALICE)}/bafkvideo/playlist.m3u8`

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
  await waitForSignedInHome(page, origin)
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
    // Rule 4: the failed native stream falls back once when MSE exists.
    // With no native HLS, MSE uses hls.js directly. Both load one chunk.
    const mse = await page.evaluate(() => 'MediaSource' in window || 'ManagedMediaSource' in window)
    expect(hlsChunk).toHaveLength(mse ? 1 : 0)
  })

  test('rule 4: without native HLS, hls.js loads once, on the press, and a fatal error shows rule 6', async ({ page, baseURL }) => {
    await forceHlsJs(page)
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
    // By keyboard (rules 2 and 12): Space plays, the video takes focus, and
    // on the error focus moves to the link.
    await play.focus()
    await page.keyboard.press('Space')
    const alert = page.getByRole('alert').filter({ hasText: 'This video could not play.' })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert.getByRole('link', { name: 'Watch on bsky.app' })).toBeFocused()
    expect(hlsChunk).toHaveLength(1)
    expect(playlistAsked).toContain(PLAYLIST)
  })

  // Rules 3 and 4 with a real stream: the playback position moves.
  async function pressPlayAndWatch(page: Page, baseURL: string | undefined, how: 'native' | 'hls.js', audible = false) {
    const origin = loopbackOrigin(baseURL)
    const hlsChunk: string[] = []
    page.on('request', (req) => { if (/\/hls-[^/]*\.js$/.test(req.url())) hlsChunk.push(req.url()) })
    await page.addInitScript(() => {
      const real = HTMLMediaElement.prototype.play
      const state = { inPress: false, nativeCalls: [] as boolean[] }
      Object.assign(window, { __nativePlay: state })
      document.addEventListener('click', () => { state.inPress = true }, true)
      document.addEventListener('click', () => { state.inPress = false })
      HTMLMediaElement.prototype.play = function () {
        if (this.src.endsWith('.m3u8')) state.nativeCalls.push(state.inPress)
        return real.call(this)
      }
    })
    const served = await routeHlsFixture(page, audible)
    // Rule 2: a plain click plays here. A new tab (bsky.app) would mean the
    // click was not stopped; `page.url()` cannot see that.
    const popups: string[] = []
    page.on('popup', (p) => popups.push(p.url()))
    await installFixtureAuth(page, { xrpc: appview })
    await signIn(page, origin)
    const play = page.getByRole('link', { name: 'Play video: A caribou running' })
    await expect(play).toBeVisible({ timeout: 15_000 })
    await page.waitForLoadState('networkidle')
    expect(served.filter((f) => f !== 'thumbnail.jpg')).toEqual([])
    await play.click()
    const video = page.locator('caribou-bluesky-video video')
    await expect(video).toBeFocused()
    // The stream is two seconds long. Past half a second it really played.
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 })
      .toBeGreaterThan(0.5)
    const state = await video.evaluate((v: HTMLVideoElement) => ({ error: v.error?.code ?? null, blob: v.src.startsWith('blob:') }))
    expect(state).toEqual({ error: null, blob: how === 'hls.js' })
    if (audible) {
      expect(await video.evaluate((v: HTMLVideoElement) => ({ muted: v.muted, volume: v.volume })))
        .toEqual({ muted: false, volume: 1 })
    }
    expect(served).toEqual(expect.arrayContaining(['playlist.m3u8', 'video.m3u8', 'seg0.m2ts']))
    expect(hlsChunk).toHaveLength(how === 'hls.js' ? 1 : 0)
    if (how === 'native') {
      expect(await page.evaluate(() => (window as unknown as {
        __nativePlay: { nativeCalls: boolean[] }
      }).__nativePlay.nativeCalls)).toEqual([true])
    }
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await noNewTab(page, popups)).toEqual([])
  }

  // In CI, Chromium is the browser that runs this one: Playwright's Chromium
  // answers `canPlayType` for HLS, while WebKit on Linux and Firefox do not.
  // MSE stays available: native HLS must still play first (#279).
  test('rule 3: native HLS plays first with MSE and loads no hls.js (#279)', async ({ page, baseURL }) => {
    const native = await page.evaluate(() => document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '')
    test.skip(!native, 'this browser has no native HLS (the next tests cover hls.js)')
    await pressPlayAndWatch(page, baseURL, 'native', true)
  })

  test('rule 4: with hls.js the stream plays', async ({ page, baseURL }) => {
    await forceHlsJs(page)
    await pressPlayAndWatch(page, baseURL, 'hls.js')
  })

  // #277: Vivaldi on macOS answers "maybe" for native HLS and then cannot
  // play it. A native error switches to hls.js once (#279).
  test('rule 4: a browser that answers "maybe" with a broken native player still plays (#277)', async ({ page, baseURL }) => {
    await brokenNativeHls(page)
    await pressPlayAndWatch(page, baseURL, 'hls.js')
  })
})
