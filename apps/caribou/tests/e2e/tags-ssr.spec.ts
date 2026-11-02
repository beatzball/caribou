import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { livePage, serverPageReport, watchServerPage } from './_server-page.js'

// The tag page as the server paints it from an instance. This spec starts
// its own server from the build, with `fixtures/upstream-stub.mjs` answering
// the server's requests to example.social, and a storage directory that
// trusts that host for the instance cookie. So it runs in CI, with no real
// instance.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '../../dist/server/server/index.mjs')
const STUB = resolve(__dirname, 'fixtures/upstream-stub.mjs')
const CARD_BODY = 'article[data-variant]'

// One worker for the whole file, so it starts one server.
test.describe.configure({ mode: 'default' })

let server: ChildProcess | undefined
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
  storage = mkdtempSync(join(tmpdir(), 'caribou-tags-ssr-'))
  // Any key under `apps:example.social:` opens the cookie gate. The dummy
  // credentials are never sent: the spec never signs in.
  mkdirSync(join(storage, 'apps/example.social'), { recursive: true })
  writeFileSync(join(storage, 'apps/example.social/e2e-seed'),
    JSON.stringify({ client_id: 'e2e', client_secret: 'e2e', vapid_key: 'e2e', registered_at: 1 }))
  const port = await freePort()
  base = `http://localhost:${port}`
  server = spawn(process.execPath, ['--import', STUB, SERVER], {
    env: { ...process.env, PORT: String(port), STORAGE_DIR: storage },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const start = Date.now()
  for (;;) {
    try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* not up yet */ }
    if (Date.now() - start > 15_000) throw new Error('test server did not start')
    await new Promise((r) => setTimeout(r, 200))
  }
})

test.afterAll(() => {
  server?.kill('SIGTERM')
  if (storage) rmSync(storage, { recursive: true, force: true })
})

async function withInstance(context: BrowserContext) {
  await context.addCookies([{
    name: 'caribou.instance', value: 'example.social', domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])
}

async function settled(page: Page) {
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

const ids = (page: Page) => livePage(page).locator('caribou-status-card').evaluateAll(
  (cards) => cards.map((c) => (c as HTMLElement).dataset.statusId))

const cookie = { Cookie: 'caribou.instance=example.social' }

test('the server paints the heading and the cards, and titles the page', async ({ request }) => {
  const body = await (await request.get(`${base}/tags/AI`, { headers: cookie })).text()
  expect(body).toContain('<title>#AI · Caribou</title>')
  expect(body).toContain('"kind":"ok"')
  expect(body.match(/<caribou-status-card\s/g) ?? []).toHaveLength(2)
  expect(body).toContain('data-status-id="ai-2"')
  expect(body).toMatch(/<a href="\?max_id=ai-1" rel="next" data-sentinel/)
  expect(body).not.toContain('class="follow"')
})

test('the server titles a non-ASCII tag, decoded once', async ({ request }) => {
  const body = await (await request.get(`${base}/tags/${encodeURIComponent('日本')}`, { headers: cookie })).text()
  expect(body).toContain('<title>#日本 · Caribou</title>')
  expect(body).toContain(`data-status-id="${encodeURIComponent('日本')}-2"`)
})

test('the server escapes a name that is not a hashtag in the title', async ({ request }) => {
  const body = await (await request.get(`${base}/tags/${encodeURIComponent('<b>"x"</b>')}`, { headers: cookie })).text()
  expect(body).toContain('<title>#&lt;b&gt;&quot;x&quot;&lt;/b&gt; · Caribou</title>')
  expect(body).not.toContain('<title>#<b>')
})

test('the server-painted cards hydrate in place', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await withInstance(context)
  await watchServerPage(page, CARD_BODY)
  await page.goto(`${base}/tags/AI`)
  await settled(page)
  const report = await serverPageReport(page)
  expect(report?.sent).toBe(2)
  expect(report).toEqual({ sent: 2, atSwap: 2, sameNodes: true, deferred: [] })
  expect(await ids(page)).toEqual(['ai-2', 'ai-1'])
  await expect(page).toHaveTitle('#AI · Caribou')
  expect(errors).toEqual([])
})

test('two tags keep their own lists across a revisit', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await withInstance(context)
  await page.goto(`${base}/tags/AI`)
  await settled(page)
  const go = (path: string) => page.evaluate((p) => {
    history.pushState(null, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await go('/tags/Rust')
  await expect(livePage(page).locator('caribou-tag-header h1')).toHaveText('#Rust')
  await expect.poll(() => ids(page)).toEqual(['rust-2', 'rust-1'])
  await expect(page).toHaveTitle('#Rust · Caribou')
  // Hold the revisit's page data. The list must be there without it: the
  // page comes back from what was kept, not from a new fetch.
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  let asked = false
  await page.route((url) => url.pathname === '/tags/AI', async (route) => {
    if (!/application\/json/.test(route.request().headers()['accept'] ?? '')) return route.continue()
    asked = true
    await held
    return route.continue()
  })
  await page.goBack()
  await expect(livePage(page).locator('caribou-tag-header h1')).toHaveText('#AI')
  await expect.poll(() => ids(page)).toEqual(['ai-2', 'ai-1'])
  await expect(page).toHaveTitle('#AI · Caribou')
  await expect.poll(() => asked).toBe(true)
  release()
  // The fresh copy brings nothing new, so the list stays as it is.
  await page.waitForLoadState('networkidle')
  expect(await ids(page)).toEqual(['ai-2', 'ai-1'])
  expect(errors).toEqual([])
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the cards and the older-posts link work', async ({ page, context }) => {
    await withInstance(context)
    await page.goto(`${base}/tags/AI`)
    await expect(page.locator('caribou-tag-header h1')).toHaveText('#AI')
    await expect(page.locator('caribou-status-card')).toHaveCount(2)
    await page.locator('a[rel="next"][data-sentinel]').click()
    await expect(page).toHaveURL(/\/tags\/AI\?max_id=ai-1$/)
    await expect(page.getByText('No posts with #AI yet.')).toBeVisible()
  })
})
