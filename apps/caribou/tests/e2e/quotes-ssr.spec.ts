import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from './_fixtures.js'
import { livePage, serverPageReport, watchServerPage } from './_server-page.js'

// A quote post (Mastodon 4.5) as the server paints it on its thread page.
// Like tags-ssr.spec.ts, this spec starts its own server from the build,
// with `fixtures/upstream-stub.mjs` answering the server's requests to
// example.social, so it runs in CI with no real instance.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '../../dist/server/server/index.mjs')
const STUB = resolve(__dirname, 'fixtures/upstream-stub.mjs')

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
  storage = mkdtempSync(join(tmpdir(), 'caribou-quotes-ssr-'))
  // Any key under `apps:example.social:` opens the cookie gate.
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

const cookie = { Cookie: 'caribou.instance=example.social' }
const quote = (page: Page) => livePage(page).locator('caribou-status-quote')

test('the server paints the quoted post, cleaned, inside the quoting post', async ({ request }) => {
  const body = await (await request.get(`${base}/@alice/quoting-1`, { headers: cookie })).text()
  expect(body).toMatch(/<caribou-status-quote[^>]*><template shadowroot="open"/)
  expect(body).toContain('the quoted words')
  expect(body).not.toContain('onclick="bad()"')
  expect(body).toContain('href="/@bob/quoted-1"')
})

test('the server-painted quote hydrates in place', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await withInstance(context)
  await watchServerPage(page, 'div.quote')
  await page.goto(`${base}/@alice/quoting-1`)
  await settled(page)
  expect(await serverPageReport(page)).toEqual({ sent: 1, atSwap: 1, sameNodes: true, deferred: [] })
  await expect(quote(page).locator('.quote-content')).toContainText('the quoted words')
  expect(errors).toEqual([])
})

// The server reads without a token, so its copy says the quote is
// accepted. The reader's copy says the reader muted (or blocked) the
// quoted author. Once the reader's check settles, the quoted post must not
// show: the thread keeps its own copy, so the card takes the quote from
// the reader's copy in the cache.
for (const state of ['muted_account', 'blocked_account'] as const) {
  test(`a signed-in reader's ${state} quote state hides the quoted post on a thread`, async ({ page, context }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await withInstance(context)
    await page.addInitScript(() => {
      const account = { id: 'me', username: 'reader', acct: 'reader', display_name: 'Reader' }
      const session = { userKey: 'reader@example.social', server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }
      localStorage.setItem('caribou.users', JSON.stringify([[session.userKey, session]]))
      localStorage.setItem('caribou.activeUserKey', JSON.stringify(session.userKey))
    })
    const asked: string[][] = []
    await page.route('https://example.social/api/v1/statuses?*', async (route) => {
      const ids = new URL(route.request().url()).searchParams.getAll('id[]')
      asked.push(ids)
      const alice = {
        id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example', avatar: '', avatar_static: '',
        url: 'https://example.social/@alice', note: '', fields: [], emojis: [],
      }
      const reader = {
        id: 'quoting-1', uri: 'https://example.social/@alice/quoting-1', url: 'https://example.social/@alice/quoting-1',
        created_at: '2024-01-01T00:00:00.000Z', account: alice, content: '<p>look at this</p>',
        visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], emojis: [],
        mentions: [], tags: [], reblogs_count: 0, favourites_count: 0, replies_count: 0, language: 'en',
        quote: { state, quoted_status: null },
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ids.map(() => reader)) })
    })
    await page.goto(`${base}/@alice/quoting-1`)
    await settled(page)
    await expect.poll(() => asked.flat()).toContain('quoting-1')
    const verb = state === 'muted_account' ? 'muted' : 'blocked'
    await expect(quote(page).locator('.quote-note')).toContainText(`you ${verb} its author`)
    await expect(quote(page).locator('.quote-content')).toHaveCount(0)
    await expect(quote(page).locator('img')).toHaveCount(0)
    await expect(livePage(page)).not.toContainText('the quoted words')
    expect(errors).toEqual([])
  })
}

test('the server paints a quoted post with a content warning collapsed; Show more opens it', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await withInstance(context)
  await page.goto(`${base}/@alice/quoting-cw`)
  await settled(page)
  await expect(quote(page).locator('.spoiler')).toHaveText('Spoilers ahead')
  await expect(quote(page).locator('.quote-content')).toHaveCount(0)
  await quote(page).getByRole('button', { name: 'Show more' }).click()
  await expect(quote(page).locator('.quote-content')).toContainText('hidden words')
  expect(errors).toEqual([])
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the quote and a pending quote show; the quote links to its thread', async ({ page, context }) => {
    await withInstance(context)
    await page.goto(`${base}/@alice/quoting-1`)
    await expect(page.locator('caribou-status-quote .quote-content')).toContainText('the quoted words')
    await expect(page.locator('caribou-status-quote a.permalink')).toHaveAttribute('href', '/@bob/quoted-1')
    await page.goto(`${base}/@alice/quoting-pending`)
    await expect(page.locator('caribou-status-quote .quote-note')).toContainText('has not approved')
  })
})
