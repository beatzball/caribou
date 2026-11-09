import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from './_fixtures.js'

// A remote profile whose own server refuses Caribou's server (app README,
// "A refused remote profile"). Own test server: `_refusing-host.mjs` is
// loaded into it, so `refuses.example` answers the lookup and a 401 for the
// posts, and the server never leaves the machine. The reader's home server
// (`example.social`) is answered in the browser.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '../../dist/server/server/index.mjs')
const REFUSING_HOST = resolve(__dirname, '_refusing-host.mjs')
const PATH = '/@carol@refuses.example'

test.describe.configure({ mode: 'serial' })

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
  storage = mkdtempSync(join(tmpdir(), 'caribou-refused-'))
  const port = await freePort()
  base = `http://localhost:${port}`
  server = spawn(process.execPath, ['--import', REFUSING_HOST, SERVER], {
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

test.afterAll(async () => {
  server?.kill('SIGTERM')
  if (storage) rmSync(storage, { recursive: true, force: true })
})

// The same account as the reader's home server knows it, by its own id.
const HOME_ACCOUNT = {
  id: 'home-99', username: 'carol', acct: 'carol@refuses.example', display_name: 'Carol Home',
  url: 'https://refuses.example/@carol', avatar: '', avatar_static: '', header: '', header_static: '',
  note: '<p>bio of carol</p>', followers_count: 1, following_count: 1, statuses_count: 1,
  locked: true, bot: false, discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}
const BOB = { ...HOME_ACCOUNT, id: 'b1', username: 'bob', acct: 'bob', display_name: 'Bob', url: 'https://example.social/@bob' }

function homePost(id: string, content: string) {
  return {
    id, uri: `https://refuses.example/@carol/${id}`, url: `https://refuses.example/@carol/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: HOME_ACCOUNT, content,
    visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  return errors
}

async function settled(page: Page) {
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

// The browser never asks the refusing server itself.
async function watchRefusingHost(page: Page): Promise<string[]> {
  const asked: string[] = []
  await page.route('https://refuses.example/**', (route) => {
    asked.push(route.request().url())
    return route.abort()
  })
  return asked
}

test('the server sends the loading shell, with nothing from the refusing server', async () => {
  const res = await fetch(`${base}${PATH}`)
  const text = await res.text()
  expect(res.status).toBe(200)
  expect(text).toContain('"kind":"refused"')
  expect(text).toContain('Loading…')
  expect(text).not.toContain('Carol Path')
  expect(text).not.toContain("Couldn't load profile")
})

test('signed out: the message and a link to the account\'s own page', async ({ page }) => {
  const errors = trackErrors(page)
  const asked = await watchRefusingHost(page)
  await page.goto(`${base}${PATH}`)
  await settled(page)
  await expect(page.getByText('refuses.example does not allow Caribou to show this profile.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'open @carol@refuses.example on refuses.example' }))
    .toHaveAttribute('href', 'https://refuses.example/@carol')
  await expect(page.getByText("Couldn't load profile")).toHaveCount(0)
  expect(asked).toEqual([])
  expect(errors).toEqual([])
})

test('signed in: the profile and its posts, through the reader\'s own server', async ({ page }) => {
  const errors = trackErrors(page)
  const asked = await watchRefusingHost(page)
  await page.addInitScript((account) => {
    const session = {
      userKey: 'bob@example.social', server: 'example.social', token: 'TOKEN',
      vapidKey: '', account, createdAt: 1,
    }
    localStorage.setItem('caribou.users', JSON.stringify([[session.userKey, session]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(session.userKey))
  }, BOB)
  const lookups: string[] = []
  await page.route('https://example.social/api/v1/accounts/lookup*', (route) => {
    lookups.push(new URL(route.request().url()).searchParams.get('acct') ?? '')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HOME_ACCOUNT) })
  })
  await page.route('https://example.social/api/v1/accounts/home-99/statuses*', (route) => {
    const u = new URL(route.request().url())
    const body = u.searchParams.get('max_id') ? [] : [homePost('h2', '<p>carol newest</p>'), homePost('h1', '<p>carol older</p>')]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto(`${base}${PATH}`)
  await settled(page)
  await expect(page.getByText('Carol Home').first()).toBeVisible()
  await expect(page.getByText('carol newest')).toBeVisible()
  await expect(page.getByText('carol older')).toBeVisible()
  await expect(page.locator('caribou-profile-tabs a[aria-current="page"]')).toHaveText('posts')
  await expect(page.locator('caribou-profile-tabs a', { hasText: 'media' })).toHaveAttribute('href', `${PATH}?tab=media`)
  await expect(page.getByText(/does not allow/)).toHaveCount(0)
  expect(lookups.length).toBeGreaterThan(0)
  expect(lookups.every((acct) => acct === 'carol@refuses.example')).toBe(true)
  expect(asked).toEqual([])
  expect(errors).toEqual([])
})
