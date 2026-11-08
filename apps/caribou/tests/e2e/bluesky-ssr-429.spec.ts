import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from './_fixtures.js'
import { livePage } from './_server-page.js'
import { startAppViewStub, type AppViewStub } from './_appview-stub.js'
import {
  HANA_SECRETS, NORA_SECRETS, PARTIAL_SECRETS,
} from '../../../../packages/bluesky-client/src/__fixtures__/ssr-appview.js'

// #187: the public AppView rate limits the server (a 429). The server sends
// the page's loading shell and backs off; the browser reads the same data
// from the AppView itself, through the same signed-out guard. Own server and
// own fixture AppView: the back-off is server-wide, so it must not reach
// the other Bluesky specs.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '../../dist/server/server/index.mjs')
const NOTICE = 'This account asked to be seen only by signed-in readers.'
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

test.describe.configure({ mode: 'serial' })

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
  storage = mkdtempSync(join(tmpdir(), 'caribou-bluesky-429-'))
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

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
})

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function settled(page: Page) {
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

// Everything the page shows, shadow roots included.
const deepHtml = (page: Page) => page.evaluate(() => {
  const walk = (root: Document | ShadowRoot | Element): string => {
    let out = root instanceof Element ? root.outerHTML : root instanceof ShadowRoot ? root.innerHTML : ''
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out += walk(el.shadowRoot)
    return out
  }
  return document.documentElement.outerHTML + walk(document)
})

test('a 429: the server sends the loading shell, with no handle and no data', async () => {
  appview.rateLimit('app.bsky.actor.getProfile', 1, '30')
  const res = await fetch(`${base}/@alice.example.com`)
  const text = await res.text()
  expect(res.status).toBe(200)
  expect(text).toContain('"kind":"deferred"')
  expect(text).toContain('Loading…')
  expect(text).not.toContain('Alice Visible')
  expect(text).not.toContain('alice.example.com')
})

test('inside the back-off: no server fetch, the shell again', async () => {
  const before = appview.serverRequests.length
  const profile = await (await fetch(`${base}/@bob.example.com`)).text()
  const thread = await (await fetch(`${base}/@alice.example.com/3kalicefocus`)).text()
  expect(profile).toContain('"kind":"deferred"')
  expect(thread).toContain('"kind":"deferred"')
  expect(appview.serverRequests.length).toBe(before)
})

test('the browser reads the profile itself: posts, notices, nothing hidden, no hydration error', async ({ page }) => {
  const errors = collectErrors(page)
  const before = appview.serverRequests.length
  await page.goto(`${base}/@alice.example.com`)
  await settled(page)
  await expect(livePage(page).getByText('alice plain post')).toBeVisible()
  await expect(livePage(page).getByText(NOTICE).first()).toBeVisible()
  const shown = await deepHtml(page)
  for (const s of [...HANA_SECRETS, ...NORA_SECRETS, ...PARTIAL_SECRETS]) expect(shown, s).not.toContain(s)
  // The server stayed backed off; the browser did the reading.
  expect(appview.serverRequests.length).toBe(before)
  expect(appview.requests.some((r) => r.startsWith('/xrpc/app.bsky.feed.getAuthorFeed'))).toBe(true)
  expect(errors).toEqual([])
})

test('the browser reads a thread itself', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto(`${base}/@alice.example.com/3kalicefocus`)
  await settled(page)
  await expect(livePage(page).getByText('alice thread focus')).toBeVisible()
  await expect(livePage(page).getByText(NOTICE)).toHaveCount(3)
  const shown = await deepHtml(page)
  for (const s of [...HANA_SECRETS, ...PARTIAL_SECRETS]) expect(shown, s).not.toContain(s)
  expect(errors).toEqual([])
})

test('a hidden profile read by the browser is the notice, and its posts are never fetched', async ({ page }) => {
  const errors = collectErrors(page)
  const before = appview.requests.length
  await page.goto(`${base}/@hana.example.com`)
  await settled(page)
  await expect(livePage(page).getByText(NOTICE)).toBeVisible()
  expect(appview.requests.slice(before).some((r) => r.includes('getAuthorFeed'))).toBe(false)
  for (const s of HANA_SECRETS) expect(await deepHtml(page), s).not.toContain(s)
  expect(errors).toEqual([])
})
