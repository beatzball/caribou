import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from './_fixtures.js'
import { livePage, serverPageReport, watchServerPage } from './_server-page.js'
import { startAppViewStub, type AppViewStub } from './_appview-stub.js'
import {
  HANA_SECRETS, NORA_SECRETS,
} from '../../../../packages/bluesky-client/src/__fixtures__/ssr-appview.js'

// Bluesky profiles and threads as the server paints them signed out (app
// README, "Bluesky SSR"). This spec starts its own server from the build,
// with `BLUESKY_SSR=1` and `BLUESKY_PUBLIC_APPVIEW` pointed at a local
// fixture AppView, so it never reaches the real one.
//
// "Appears nowhere" checks read the whole response text: the body, the
// title, every meta tag and the serialized page data.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '../../dist/server/server/index.mjs')
const CARD_BODY = 'article[data-variant]'
const NOTICE = 'This account asked to be seen only by signed-in readers.'

test.describe.configure({ mode: 'default' })

let server: ChildProcess | undefined
let appview: AppViewStub
let storage = ''
let base = ''

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.on('error', rej)
    srv.listen(0, () => {
      const addr = srv.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      srv.close(() => (port ? res(port) : rej(new Error('no port'))))
    })
  })
}

test.beforeAll(async () => {
  if (!existsSync(SERVER)) throw new Error(`No build at ${SERVER}. Run \`pnpm --filter caribou-app build\` first.`)
  appview = await startAppViewStub()
  storage = mkdtempSync(join(tmpdir(), 'caribou-bluesky-ssr-'))
  const port = await freePort()
  base = `http://localhost:${port}`
  server = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), STORAGE_DIR: storage,
      BLUESKY_SSR: '1', BLUESKY_PUBLIC_APPVIEW: appview.url,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const start = Date.now()
  for (;;) {
    try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* not up yet */ }
    if (Date.now() - start > 15_000) throw new Error('test server did not start')
    await new Promise((r) => setTimeout(r, 200))
  }
})

test.afterAll(async () => {
  server?.kill('SIGTERM')
  await appview?.close()
  if (storage) rmSync(storage, { recursive: true, force: true })
})

async function body(path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${path}`)
  return { status: res.status, text: await res.text() }
}

function expectNowhere(text: string, secrets: readonly string[]) {
  for (const s of secrets) expect(text, `"${s}" is in the response`).not.toContain(s)
}

const count = (text: string, s: string) => text.split(s).length - 1
// A notice card as the server renders it: Lit's markers sit around the text.
const noticeCards = (text: string) => (text.match(/<p><!--lit-part[^>]*-->This account asked to be seen only by signed-in readers\./g) ?? []).length

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
})

async function settled(page: Page) {
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

test.describe('the server response', () => {
  test('a profile: the account, its cards and the first cursor', async () => {
    const { status, text } = await body('/@alice.example.com')
    expect(status).toBe(200)
    expect(text).toContain('Alice Visible')
    expect(text).toContain('alice plain post')
    expect(text).toMatch(/href="\/@alice\.example\.com\?tab=posts&amp;max_id=cursor-page-2" rel="next"/)
    // Viewer state is empty in the page data.
    expect(text).not.toMatch(/"viewerOf":"[^"]/)
  })

  test('a profile by DID', async () => {
    const { status, text } = await body('/@did:plc:alice')
    expect(status).toBe(200)
    expect(text).toContain('Alice Visible')
    expect(text).toContain('"handle":"did:plc:alice"')
  })

  test('a thread: hidden posts are notices, the rest renders', async () => {
    const { status, text } = await body('/@alice.example.com/3kalicefocus')
    expect(status).toBe(200)
    expect(text).toContain('alice thread focus')
    expect(text).toContain('bob parent post')
    expect(text).toContain('carol thread reply')
    // The root and one reply are hana's.
    expect(noticeCards(text)).toBe(2)
    expectNowhere(text, HANA_SECRETS)
  })

  test('a bad handle, DID or record key: 404, and no request to the AppView', async () => {
    const before = appview.requests.length
    for (const path of ['/@-bad.example.com', '/@did:plc:', '/@a..b', '/@alice.example.com/a%20b']) {
      const { status, text } = await body(path)
      expect(status, path).toBe(404)
      expect(text).toContain('<caribou-app-shell')
    }
    expect(appview.requests.slice(before)).toEqual([])
  })

  test('an AppView error: the shell and a message, no crash', async () => {
    const profile = await body('/@broken.example.com')
    expect(profile.status).toBe(200)
    expect(profile.text).toContain('<caribou-app-shell')
    expect(profile.text).toContain('Couldn')
    const thread = await body('/@broken.example.com/3kanything')
    expect(thread.status).toBe(200)
    expect(thread.text).toContain('<caribou-app-shell')
  })

  test('the server fetches only the fixture AppView', async () => {
    expect(appview.requests.length).toBeGreaterThan(0)
    expect(appview.requests.every((r) => r.startsWith('/xrpc/'))).toBe(true)
  })
})

test.describe('!no-unauthenticated: nothing of a hidden author in the whole response (spec 8.3)', () => {
  test('the profile of an author with the label: the shell and the notice', async () => {
    const { status, text } = await body('/@hana.example.com')
    expect(status).toBe(200)
    expect(text).toContain(NOTICE)
    expect(text).toContain('"kind":"hidden"')
    expectNowhere(text, HANA_SECRETS)
  })

  test('the profile by DID of an author with the label', async () => {
    const { text } = await body('/@did:plc:hana')
    expect(text).toContain(NOTICE)
    expectNowhere(text, HANA_SECRETS)
  })

  test('the profile of an author whose labels are missing (fail closed)', async () => {
    const { text } = await body('/@nora.example.com')
    expect(text).toContain(NOTICE)
    expectNowhere(text, NORA_SECRETS)
  })

  test('a visible profile: feed items, a repost, the reposter line, a quote, a reply\'s parent and root, a record card', async () => {
    const { text } = await body('/@alice.example.com')
    expectNowhere(text, HANA_SECRETS)
    expectNowhere(text, NORA_SECRETS)
    // Notice cards: hana's repost, nora's repost, the repost by hana.
    expect(noticeCards(text)).toBe(3)
    // The quote card's note and the record card's title.
    expect(text).toContain('alice quoting hana')
    expect(text).toContain('alice sharing a list')
    expect(count(text, NOTICE)).toBeGreaterThanOrEqual(5)
  })

  test('a thread focused on a hidden author\'s post: the notice, and no handle in the page data', async () => {
    const { status, text } = await body('/@hana.example.com/3khanafocus')
    expect(status).toBe(200)
    expect(noticeCards(text)).toBe(1)
    expect(text).toContain('carol reply to hana')
    expect(text).toContain('"handle":""')
    expectNowhere(text, HANA_SECRETS)
  })

  test('control: with no label, the author\'s name, handle, bio and text are all there', async () => {
    const { text } = await body('/@alice.example.com')
    for (const s of ['Alice Visible', 'alice.example.com', 'Alice bio text', 'https://cdn.example.com/alice-avatar.jpg', 'alice plain post']) {
      expect(text).toContain(s)
    }
  })
})

test.describe('moderation in the server render (spec 7.4)', () => {
  test('an adult label in a list, signed out: the card is filtered out and draws nothing', async () => {
    const { text } = await body('/@alice.example.com')
    // The card is there, and its shadow root holds its styles and no post.
    const at = text.indexOf('data-status-id="at://did:plc:alice/app.bsky.feed.post/3kalicegraphic"')
    expect(at).toBeGreaterThan(0)
    const card = text.slice(at, text.indexOf('</caribou-status-card', at))
    expect(card).not.toContain('<article')
    // The page data keeps the URLs (a reader with adult content on needs them); the markup draws no image.
    expect(text).not.toMatch(/<img[^>]+graphic-(thumb|full)\.jpg/)
  })

  test('an adult label on the focused post: the media is covered with no Show button', async ({ page }) => {
    const errors = collectErrors(page)
    const { text } = await body('/@did:plc:alice/3kaliceadult')
    expect(text).toContain('alice adult post')
    expect(text).not.toMatch(/<img[^>]+adult-(thumb|full)\.jpg/)
    await page.goto(`${base}/@did:plc:alice/3kaliceadult`)
    await settled(page)
    const media = livePage(page).locator('caribou-status-media')
    await expect(media).toHaveAttribute('no-override', '')
    await expect(media.getByRole('button', { name: /show/i })).toHaveCount(0)
    await expect(media.locator('img')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

test.describe('hydration, signed out', () => {
  test('the profile hydrates in place, and the first cursor loads page two', async ({ page }) => {
    const errors = collectErrors(page)
    await watchServerPage(page, CARD_BODY)
    await page.goto(`${base}/@alice.example.com`)
    await settled(page)
    const report = await serverPageReport(page)
    expect(report?.sent).toBeGreaterThan(0)
    expect(report).toEqual({ sent: report!.sent, atSwap: report!.sent, sameNodes: true, deferred: [] })
    await expect(livePage(page).getByText(NOTICE).first()).toBeVisible()
    await livePage(page).getByRole('link', { name: /Older posts/ }).click()
    await expect(page).toHaveURL(/max_id=cursor-page-2/)
    await expect(livePage(page).getByText('alice page two post')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('the thread hydrates in place', async ({ page }) => {
    const errors = collectErrors(page)
    await watchServerPage(page, CARD_BODY)
    await page.goto(`${base}/@alice.example.com/3kalicefocus`)
    await settled(page)
    const report = await serverPageReport(page)
    expect(report).toEqual({ sent: 5, atSwap: 5, sameNodes: true, deferred: [] })
    await expect(livePage(page).getByText(NOTICE)).toHaveCount(2)
    expect(errors).toEqual([])
  })

  test('a hidden profile hydrates and stays hidden', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto(`${base}/@hana.example.com`)
    await settled(page)
    await expect(livePage(page).getByText(NOTICE)).toBeVisible()
    expect(await page.content()).not.toContain('Hana Hidden')
    expect(errors).toEqual([])
  })

  test('a profile opened by DID shows the handle in the address bar after hydration', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto(`${base}/@did:plc:alice?tab=posts`)
    await settled(page)
    await expect(page).toHaveURL(`${base}/@alice.example.com?tab=posts`)
    await expect(livePage(page).getByText('alice plain post')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('a thread opened by DID shows the handle in the address bar after hydration', async ({ page }) => {
    await page.goto(`${base}/@did:plc:alice/3kalicefocus`)
    await settled(page)
    await expect(page).toHaveURL(`${base}/@alice.example.com/3kalicefocus`)
  })
})

test.describe('hydration with a Mastodon account active', () => {
  test.beforeEach(async ({ page }) => {
    const session = {
      userKey: 'bob@example.social', server: 'example.social', token: 'TOKEN', vapidKey: '',
      account: { id: '1', username: 'bob', acct: 'bob', displayName: 'Bob', avatar: '', url: 'https://example.social/@bob' },
      createdAt: 1,
    }
    await page.addInitScript((data) => {
      localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
      localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
    }, session)
    await page.route('https://example.social/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  })

  test('the profile hydrates and hidden authors stay hidden', async ({ page }) => {
    const errors = collectErrors(page)
    await watchServerPage(page, CARD_BODY)
    await page.goto(`${base}/@alice.example.com`)
    await settled(page)
    const report = await serverPageReport(page)
    expect(report).toEqual({ sent: report!.sent, atSwap: report!.sent, sameNodes: true, deferred: [] })
    await expect(livePage(page).getByText(NOTICE).first()).toBeVisible()
    await expect(livePage(page).getByText('alice plain post')).toBeVisible()
    expect(await page.content()).not.toContain('Hana Hidden')
    expect(errors).toEqual([])
  })

  test('the thread hydrates, and no Bluesky post is sent to the Mastodon server', async ({ page }) => {
    const errors = collectErrors(page)
    const asked: string[] = []
    page.on('request', (r) => { if (r.url().startsWith('https://example.social/')) asked.push(r.url()) })
    await watchServerPage(page, CARD_BODY)
    // The cookie names the reader's server, so the shell carries it.
    await page.context().addCookies([{ name: 'caribou.instance', value: 'example.social', domain: 'localhost', path: '/' }])
    await page.goto(`${base}/@alice.example.com/3kalicefocus`)
    await settled(page)
    const report = await serverPageReport(page)
    expect(report).toEqual({ sent: 5, atSwap: 5, sameNodes: true, deferred: [] })
    await expect(livePage(page).getByText('alice thread focus')).toBeVisible()
    await expect(livePage(page).getByText(/Could not check this post/)).toHaveCount(0)
    expect(asked.filter((u) => decodeURIComponent(u).includes('at://'))).toEqual([])
    expect(errors).toEqual([])
  })
})
