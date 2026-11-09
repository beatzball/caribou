import { expect, test, type Page } from '@playwright/test'

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

test('a Mastodon page does not request the atproto libraries', async ({ page }) => {
  const scripts = await scriptsFetched(page, '/')
  expect(scripts.length).toBeGreaterThan(0)
  expect(scripts.filter((s) => s.body.includes(ATPROTO_MARKER)).map((s) => s.url)).toEqual([])
})

test('with the Bluesky flag on, the libraries arrive in the bsky chunk', async ({ page }) => {
  // The control: proves the marker finds the libraries when they do load.
  await page.addInitScript(() => localStorage.setItem('caribou.flag.bluesky', '1'))
  const scripts = await scriptsFetched(page, '/')
  const atproto = scripts.filter((s) => s.body.includes(ATPROTO_MARKER)).map((s) => new URL(s.url).pathname)
  expect(atproto).toEqual([expect.stringMatching(/\/bsky-[\w-]+\.js$/)])
})
