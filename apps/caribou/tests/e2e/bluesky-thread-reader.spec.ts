import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { startAppViewStub, type AppViewStub } from './_appview-stub.js'
import { ALICE, installFixtureAuth, type XrpcAnswer, waitForSignedInHome } from './_bluesky-auth.js'
import {
  BSKY_LABELER, carolFocus, carolThreadPosts, labelerServices,
} from '../../../../packages/bluesky-client/src/__fixtures__/ssr-appview.js'

// A signed-in Bluesky reader opens a thread the server painted signed out
// (#273). The server's page data is `kind: 'ok'`, its posts' decisions are
// for no reader (`viewerOf` null), as the real server sends. Every card must
// show the reader's own copy, not "Checking this post against your
// moderation settings…" (app README, "Bluesky views": a kept thread belongs
// to one reader).
//
// This spec starts its own server from the build, with
// `BLUESKY_PUBLIC_APPVIEW` pointed at a local fixture AppView, so neither
// the server nor the browser reaches the real one.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '../../dist/server/server/index.mjs')
const ADDRESS = `/@carol.example.com/3kcarolfocus`
const TEXTS = ['bob opens the thread', 'carol focused post', 'bob replies to carol']
const CHECKING = 'Checking this post against your moderation settings'
const COVERED = { 'atproto-content-labelers': `${BSKY_LABELER};redact` }

test.describe.configure({ mode: 'default' })

let server: ChildProcess | undefined
let appview: AppViewStub
let storage = ''
let origin = ''

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
  storage = mkdtempSync(join(tmpdir(), 'caribou-bluesky-thread-reader-'))
  const port = await freePort()
  // A loopback origin, as the Bluesky sign-in needs (`loopbackOrigin`).
  origin = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), STORAGE_DIR: storage,
      BLUESKY_SSR: undefined, BLUESKY_PUBLIC_APPVIEW: appview.url,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const start = Date.now()
  for (;;) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break } catch { /* not up yet */ }
    if (Date.now() - start > 15_000) throw new Error('test server did not start')
    await new Promise((r) => setTimeout(r, 200))
  }
})

test.afterAll(async () => {
  server?.kill('SIGTERM')
  await appview?.close()
  if (storage) rmSync(storage, { recursive: true, force: true })
})

// The reader's own AppView, through their PDS: the same thread, read for
// them.
// The SDK reads a post view by its `$type` and checks each CID, which the
// public fixture leaves out and makes up.
const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const view = (p: { uri: string }) => ({
  $type: 'app.bsky.feed.defs#postView', ...JSON.parse(JSON.stringify(p).replace(/"bafy3k\w+"/g, `"${CID}"`)),
})
const byUri = new Map(carolThreadPosts.map((p) => [p.uri, view(p)]))
const [rootPost, , replyPost] = carolThreadPosts
const readerThread = {
  thread: {
    $type: 'app.bsky.feed.defs#threadViewPost', post: view(carolFocus),
    parent: { $type: 'app.bsky.feed.defs#threadViewPost', post: view(rootPost!) },
    replies: [{ $type: 'app.bsky.feed.defs#threadViewPost', post: view(replyPost!), replies: [] }],
  },
}
const pds: XrpcAnswer = (method, url) => {
  switch (method) {
    case 'app.bsky.feed.getTimeline':
      return { body: url.searchParams.get('cursor') ? { feed: [] } : { feed: [{ post: view(carolFocus) }] }, headers: COVERED }
    case 'app.bsky.feed.getPosts':
      return { body: { posts: url.searchParams.getAll('uris').flatMap((u) => byUri.get(u) ?? []) }, headers: COVERED }
    case 'app.bsky.feed.getPostThread':
      return { body: readerThread, headers: COVERED }
    case 'app.bsky.labeler.getServices':
      return { body: JSON.parse(JSON.stringify(labelerServices).replace('"bafylabeler"', `"${CID}"`)) }
    case 'app.bsky.notification.getUnreadCount':
      return { body: { count: 0 } }
    default:
      return undefined
  }
}

async function signIn(page: Page) {
  await installFixtureAuth(page, { sub: ALICE, xrpc: pds })
  await page.goto(`${origin}/`)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await waitForSignedInHome(page, origin)
}

async function expectReaderThread(page: Page) {
  const thread = page.locator('page-handle-statusid caribou-thread')
  await expect(thread).toHaveAttribute('statusid', carolFocus.uri)
  for (const text of TEXTS) {
    await expect(thread.locator('caribou-status-card').filter({ hasText: text })).toBeVisible()
  }
  await expect(thread.locator('caribou-status-card').filter({ hasText: CHECKING })).toHaveCount(0)
}

test.describe('a signed-in Bluesky thread the server painted signed out (#273)', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('from the time link on a Home card: every card is the reader\'s copy', async ({ page }) => {
    await signIn(page)
    const card = page.locator('page-home caribou-status-card').filter({ hasText: 'carol focused post' })
    await card.locator('litro-link.permalink time').click()
    await page.waitForURL(`${origin}${ADDRESS}`)
    await expectReaderThread(page)
  })

  test('from a direct load of the address: every card is the reader\'s copy', async ({ page }) => {
    await signIn(page)
    await page.goto(`${origin}${ADDRESS}`)
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    await expectReaderThread(page)
  })
})
