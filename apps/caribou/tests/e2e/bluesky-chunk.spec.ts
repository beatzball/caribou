import { expect, test, type Page } from '@playwright/test'
import { installFixtureAuth, loopbackOrigin } from './_bluesky-auth.js'
import { BOB, homeWith, signIn as signInMastodon, status } from './_moderation.js'

// The atproto libraries load only in their own lazy chunk (Bluesky spec 12.2,
// the `bsky` group in vite.config.ts). Without that group, rolldown puts its
// runtime helpers inside the atproto chunk, and app-main imports that chunk
// statically, so every Mastodon page downloads it.
//
// The test reads every script the page fetched and looks for atproto's own
// code by a lexicon ref it carries, not by the chunk's file name: without the
// group the chunk has another name, and that is the case to catch. The ref
// form (`lex:…`) is only in the SDK's lexicon table: Caribou's own client
// code calls `agent.com.atproto.repo.createRecord` (#189), which is in the
// main bundle and is not the libraries.
const ATPROTO_MARKER = 'lex:com.atproto.repo.strongRef'
// A second marker for `@atproto/common-web` (#189 uses its TID): the TID
// base32 alphabet. `@atproto/api`'s marker alone would miss a leak of only it.
const COMMON_WEB_MARKER = '234567abcdefghijklmnopqrstuvwxyz'

const isAtproto = (body: string) => body.includes(ATPROTO_MARKER) || body.includes(COMMON_WEB_MARKER)

async function scriptsFetched(page: Page, path: string): Promise<{ url: string; body: string }[]> {
  const scripts: Promise<{ url: string; body: string }>[] = []
  page.on('response', (res) => {
    if (res.request().resourceType() === 'script' || res.url().endsWith('.js')) {
      scripts.push(res.text().then((body) => ({ url: res.url(), body }), () => ({ url: res.url(), body: '' })))
    }
  })
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  return Promise.all(scripts)
}

test('a first visit does not request the atproto libraries', async ({ page }) => {
  const scripts = await scriptsFetched(page, '/')
  expect(scripts.length).toBeGreaterThan(0)
  expect(scripts.filter((s) => isAtproto(s.body)).map((s) => s.url)).toEqual([])
})

test('a signed-in Mastodon reader on home, with compose open, does not request them', async ({ page }) => {
  const scripts: Promise<{ url: string; body: string }>[] = []
  page.on('response', (res) => {
    if (res.request().resourceType() === 'script' || res.url().endsWith('.js')) {
      scripts.push(res.text().then((body) => ({ url: res.url(), body }), () => ({ url: res.url(), body: '' })))
    }
  })
  await signInMastodon(page)
  await homeWith(page, [status('s1', BOB)])
  await page.getByRole('button', { name: 'New post' }).click()
  await expect(page.getByRole('dialog', { name: 'New post' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const fetched = await Promise.all(scripts)
  expect(fetched.length).toBeGreaterThan(0)
  expect(fetched.filter((s) => isAtproto(s.body)).map((s) => s.url)).toEqual([])
})

test('a Bluesky sign-in brings the libraries, in the bsky chunk', async ({ page, baseURL, browserName }) => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(browserName === 'webkit' && process.platform === 'darwin', 'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')
  // The control: proves the marker finds the libraries when they do load.
  // Nothing loads them until a Bluesky sign-in starts. The fixture
  // authorization server keeps the sign-in off the network.
  const origin = loopbackOrigin(baseURL)
  await installFixtureAuth(page)
  const scripts: Promise<{ url: string; body: string }>[] = []
  page.on('response', (res) => {
    if (res.request().resourceType() === 'script' || res.url().endsWith('.js')) {
      scripts.push(res.text().then((body) => ({ url: res.url(), body }), () => ({ url: res.url(), body: '' })))
    }
  })
  await page.goto(`${origin}/`)
  // The panels are in the server HTML: wait for the router's mount swap, or
  // the tab click lands on the mount it drops.
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${origin}/home`)
  await page.waitForLoadState('networkidle')
  const fetched = await Promise.all(scripts)
  // The landing and /home are two page loads, so the chunk may come twice.
  const atproto = [...new Set(fetched.filter((s) => isAtproto(s.body)).map((s) => new URL(s.url).pathname))]
  expect(atproto).toEqual([expect.stringMatching(/\/bsky-[\w-]+\.js$/)])
  // The control for the second marker: the TID code is in the bsky chunk.
  const commonWeb = [...new Set(fetched.filter((s) => s.body.includes(COMMON_WEB_MARKER)).map((s) => new URL(s.url).pathname))]
  expect(commonWeb).toEqual([expect.stringMatching(/\/bsky-[\w-]+\.js$/)])
})
