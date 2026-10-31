import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type BrowserContext, type Page } from './_fixtures.js'

// Two accounts on two servers (#58). Sign-out leaves the other account
// signed in, and points the instance cookie at its server so SSR of the
// public feeds follows it. Sign-out of the last account goes to `/` and,
// as before, keeps the cookie.

// The cookie endpoint accepts only a server this deployment has an app for,
// so the test writes two registrations into the server's storage. Playwright
// starts the server in this app's folder, with its storage in `.data` unless
// STORAGE_DIR says otherwise. For a server started by hand (E2E_BASE_URL),
// E2E_STORAGE_DIR names its storage folder; without it the test is skipped.
test.skip(!!process.env.E2E_BASE_URL && !process.env.E2E_STORAGE_DIR,
  'Needs E2E_STORAGE_DIR to seed app registrations for an external server')
// The two tests share the seeded registrations; one worker runs them in turn.
test.describe.configure({ mode: 'serial' })

const ONE = 'e2e-one.example'
const TWO = 'e2e-two.example'
const ALICE = `alice@${ONE}`
const BOB = `bob@${TWO}`
const STORAGE = resolve(process.env.E2E_STORAGE_DIR ?? process.env.STORAGE_DIR ?? './.data')

function appDir(server: string): string {
  return join(STORAGE, 'apps', server)
}

test.beforeAll(() => {
  for (const server of [ONE, TWO]) {
    mkdirSync(appDir(server), { recursive: true })
    // `getKeys('apps:<server>:')` only needs a key to exist under the server.
    writeFileSync(join(appDir(server), 'e2e'), JSON.stringify({
      client_id: 'e2e', client_secret: 'e2e', vapid_key: '', registered_at: Date.now(),
    }))
  }
})

test.afterAll(() => {
  for (const server of [ONE, TWO]) rmSync(appDir(server), { recursive: true, force: true })
})

function account(id: string, username: string, server: string) {
  return {
    id, username, acct: username, display_name: username,
    avatar: '', avatar_static: '', url: `https://${server}/@${username}`, header: '', header_static: '',
    note: '', followers_count: 0, following_count: 0, statuses_count: 0, locked: false, bot: false,
    discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
  }
}

async function setup(page: Page, context: BrowserContext, keys: string[]) {
  await context.addCookies([{
    name: 'caribou.instance', value: TWO, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  const sessions = keys.map((userKey, i) => ({
    userKey, server: userKey.slice(userKey.indexOf('@') + 1),
    token: `TOKEN-${i}`, vapidKey: '', account: null, createdAt: i,
  }))
  await page.addInitScript((data) => {
    if (localStorage.getItem('caribou.__seeded__') === '1') return
    localStorage.setItem('caribou.users', JSON.stringify(data.sessions.map((s) => [s.userKey, s])))
    // The last one signed in last, so it is active.
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.sessions.at(-1)!.userKey))
    localStorage.setItem('caribou.__seeded__', '1')
  }, { sessions })
  // Each server answers as its own account; everything else is empty.
  for (const [server, acct] of [[ONE, account('a1', 'alice', ONE)], [TWO, account('b1', 'bob', TWO)]] as const) {
    await page.route(`https://${server}/api/**`, (route) => {
      const path = new URL(route.request().url()).pathname
      const body = path === '/api/v1/accounts/verify_credentials' ? acct : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
  }
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

async function signOut(page: Page) {
  const button = page.locator('caribou-nav-rail').locator('nav > caribou-signout-form button.signout-btn')
  await button.waitFor({ state: 'visible' })
  await button.click()
}

// Signs out and waits for the full page load that follows, at `path`. The
// reload can go to the page the test is already on, so wait for the new
// document, not for the URL.
async function signOutAndLand(page: Page, path: string) {
  const loaded = page.waitForResponse((res) =>
    res.request().resourceType() === 'document' && new URL(res.url()).pathname === path)
  await signOut(page)
  await loaded
  await page.waitForLoadState('load')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

const active = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('caribou.activeUserKey') ?? 'null') as string | null)
const stored = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('caribou.users') ?? '[]') as [string][]).map(([k]) => k))
const instanceCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((c) => c.name === 'caribou.instance')?.value

test('sign-out of one of two accounts lands signed in as the other, with the cookie on its server', async ({ page, context, browserName }) => {
  await setup(page, context, [ALICE, BOB])
  await gotoSettled(page, '/notifications')
  expect(await active(page)).toBe(BOB)

  const instancePost = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/instance',
  )
  // The reload keeps the page: notifications mean the same for any account.
  await signOutAndLand(page, '/notifications')
  const posted = await instancePost
  expect(posted.status()).toBe(204)
  expect(posted.request().postDataJSON()).toEqual({ server: ONE })
  expect(await posted.headerValue('set-cookie')).toMatch(new RegExp(`^caribou\\.instance=${ONE.replace(/\./g, '\\.')};`))

  expect(await active(page)).toBe(ALICE)
  expect(await stored(page)).toEqual([ALICE])
  // The cookie is `Secure`. WebKit drops a Secure cookie that plain-http
  // localhost sets, so only the header above is checked there.
  if (browserName !== 'webkit') expect(await instanceCookie(context)).toBe(ONE)
  await expect(page.locator('caribou-nav-rail')).not.toHaveAttribute('signed-out', /.*/)
})

test('sign-out of the last account goes to / and keeps the cookie', async ({ page, context, browserName }) => {
  await setup(page, context, [ALICE, BOB])
  await gotoSettled(page, '/home')

  await signOutAndLand(page, '/home')
  expect(await active(page)).toBe(ALICE)

  const posts: string[] = []
  page.on('request', (req) => { if (req.method() === 'POST') posts.push(new URL(req.url()).pathname) })
  await signOutAndLand(page, '/')
  expect(await active(page)).toBeNull()
  expect(await stored(page)).toEqual([])
  // No account is left, so the cookie is not touched: the public feeds
  // keep the server it named before: ONE since the first sign-out, or the
  // seeded TWO in WebKit, which dropped that Secure cookie.
  expect(posts).toEqual(['/api/signout'])
  expect(await instanceCookie(context)).toBe(browserName === 'webkit' ? TWO : ONE)
  await expect(page.locator('caribou-landing')).toHaveCount(1)
})
