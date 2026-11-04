import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from './_fixtures.js'
import { livePage, serverPageReport, watchServerPage } from './_server-page.js'
import { collectErrors, json, signIn } from './_moderation.js'
import { pollPosts } from './fixtures/upstream-stub.mjs'

// A post's poll as the server paints it on /local, then hydrated, then used
// (#55). Like tags-ssr.spec.ts, this spec starts its own server from the
// build, with `fixtures/upstream-stub.mjs` answering the server's requests
// to example.social, so it runs in CI with no real instance.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '../../dist/server/server/index.mjs')
const STUB = resolve(__dirname, 'fixtures/upstream-stub.mjs')
const API = 'https://example.social/api'

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
  storage = mkdtempSync(join(tmpdir(), 'caribou-polls-ssr-'))
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

const pollOf = (page: Page, id: string) =>
  livePage(page).locator(`caribou-status-card[data-status-id="${id}"] caribou-status-poll`)

test('the server paints each poll\'s results, with no choices to pick', async ({ request }) => {
  const body = await (await request.get(`${base}/local`, { headers: { Cookie: 'caribou.instance=example.social' } })).text()
  expect(body.match(/<caribou-status-poll\s/g) ?? []).toHaveLength(2)
  expect(body).toContain('data-state="results"')
  expect(body).toContain('data-state="ended"')
  expect(body).toContain('Tea 🍵')
  expect(body).toContain('75%')
  expect(body).toContain('--share: 75%')
  expect(body).toContain('4 people')
  expect(body).toMatch(/Ends (<!--lit-node \d+-->)?<time datetime="2099-01-01T00:00:00.000Z">/)
  expect(body).toContain('Ended')
  expect(body).not.toContain('name="choice"')
})

test('a signed-out reader: the polls hydrate in place and stay results', async ({ page, context }) => {
  const errors = collectErrors(page)
  await withInstance(context)
  await watchServerPage(page, 'li.result')
  await page.goto(`${base}/local`)
  await settled(page)
  expect(await serverPageReport(page)).toEqual({ sent: 4, atSwap: 4, sameNodes: true, deferred: [] })
  const open = pollOf(page, 'poll-open')
  await expect(open.getByText('days left')).toBeVisible()
  await expect(open.getByRole('radio')).toHaveCount(0)
  await expect(open.getByRole('button', { name: 'Vote' })).toHaveCount(0)
  await expect(pollOf(page, 'poll-ended')).toContainText('Ended')
  expect(errors).toEqual([])
})

test('a signed-in reader on the same server votes on a server-painted poll', async ({ page, context }) => {
  const errors = collectErrors(page)
  await withInstance(context)
  await signIn(page)
  // The reader's own copies of the painted posts: not voted yet.
  await page.route(`${API}/v1/statuses?*`, (route) =>
    route.fulfill(json(pollPosts().map((p) => ({ ...p, filtered: [], poll: { ...p.poll, voted: false, own_votes: [] } })))))
  await page.route(`${API}/v1/timelines/public*`, (route) => route.fulfill(json([])))
  const votes: unknown[] = []
  await page.route(`${API}/v1/polls/p-open/votes`, (route) => {
    votes.push(route.request().postDataJSON())
    const p = pollPosts()[0]!.poll
    return route.fulfill(json({ ...p, votes_count: 5, voters_count: 5, voted: true, own_votes: [1],
      options: [{ title: 'Tea 🍵', votes_count: 3 }, { title: 'Coffee', votes_count: 2 }] }))
  })
  await page.goto(`${base}/local`)
  await settled(page)
  const open = pollOf(page, 'poll-open')
  await expect(open.getByRole('radio')).toHaveCount(2)
  // An ended poll never offers a vote.
  await expect(pollOf(page, 'poll-ended').getByRole('checkbox')).toHaveCount(0)
  await open.getByRole('radio', { name: 'Coffee' }).check()
  await open.getByRole('button', { name: 'Vote' }).click()
  await expect(open).toContainText('You voted')
  await expect(open).toContainText('5 people')
  await expect(open).toContainText('40%')
  await expect(open.getByText(', your choice')).toHaveCount(1)
  expect(votes).toEqual([{ choices: [1] }])
  expect(errors).toEqual([])
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the results show', async ({ page, context }) => {
    await withInstance(context)
    await page.goto(`${base}/local`)
    await expect(page.locator('caribou-status-poll')).toHaveCount(2)
    await expect(page.locator('caribou-status-poll').first()).toContainText('Tea 🍵')
    await expect(page.locator('caribou-status-poll').first()).toContainText('75%')
  })
})
