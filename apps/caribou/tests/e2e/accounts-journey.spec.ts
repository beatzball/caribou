import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Browser, Response } from '@playwright/test'
import { expect, test, type BrowserContext, type Page } from './_fixtures.js'
import { authorizeSignsIn } from './_signin.js'

// The whole multi-account feature (#58), through the real UI: signed in as
// Alice, add Bob on another server from the account menu, switch back to
// Alice, reload, sign out of Alice and land as Bob, then a 401 for an
// account that is not active removes only that one. Plus the sign-in state
// binding: a callback URL works only in the browser that started it.
//
// The token exchange is a request from this server to the user's server,
// which a test cannot answer. So a successful callback is answered with the
// real completion page (`_signin.ts`, as `accounts-add.spec.ts` does), and
// the binding is checked by where the real callback sends a browser: the
// starting browser gets as far as the exchange (`exchange_failed`), any
// other browser stops at `state_mismatch`. A completion link someone sends
// (the old `/signin/done#token=…`) signs nobody in.

test.skip(!!process.env.E2E_BASE_URL && !process.env.E2E_STORAGE_DIR,
  'Needs E2E_STORAGE_DIR to seed app registrations for an external server')
test.describe.configure({ mode: 'serial' })

const ONE = 'e2e-journey-one.example'
const TWO = 'e2e-journey-two.example'
const ALICE = `alice@${ONE}`
const CAROL = `carol@${ONE}`
const BOB = `bob@${TWO}`
const STORAGE = resolve(process.env.E2E_STORAGE_DIR ?? process.env.STORAGE_DIR ?? './.data')
const ORIGIN = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin

// The storage key is `apps:<server>:<origin>`; the fs driver turns every `:`
// into a folder. Sign-in start needs the exact key; the cookie endpoint only
// needs one under the server.
function appFile(server: string): string {
  return join(STORAGE, 'apps', server, ...ORIGIN.split(/:\/*/))
}

test.beforeAll(() => {
  for (const server of [ONE, TWO]) {
    const file = appFile(server)
    mkdirSync(resolve(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({
      client_id: 'e2e', client_secret: 'e2e', vapid_key: '', registered_at: Date.now(),
    }))
  }
})

test.afterAll(() => {
  for (const server of [ONE, TWO]) rmSync(join(STORAGE, 'apps', server), { recursive: true, force: true })
})

function account(id: string, username: string, server: string) {
  return {
    id, username, acct: username, display_name: username,
    avatar: '', avatar_static: '', url: `https://${server}/@${username}`, header: '', header_static: '',
    note: '', followers_count: 0, following_count: 0, statuses_count: 0, locked: false, bot: false,
    discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
  }
}

// Seeds the stored accounts once (later loads keep what the app wrote), and
// answers for both servers: each token is its own account.
async function setup(page: Page, context: BrowserContext, keys: string[]) {
  await context.addCookies([{
    name: 'caribou.instance', value: ONE, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  const sessions = keys.map((userKey, i) => ({
    userKey, server: userKey.slice(userKey.indexOf('@') + 1),
    token: `TOKEN-${userKey}`, vapidKey: '', account: null, createdAt: i,
  }))
  await page.addInitScript((data) => {
    if (localStorage.getItem('caribou.__seeded__') === '1') return
    localStorage.setItem('caribou.users', JSON.stringify(data.sessions.map((s) => [s.userKey, s])))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.sessions.at(-1)!.userKey))
    localStorage.setItem('caribou.__seeded__', '1')
  }, { sessions })
  const byToken: Record<string, ReturnType<typeof account>> = {
    [`TOKEN-${ALICE}`]: account('a1', 'alice', ONE),
    [`TOKEN-${CAROL}`]: account('c1', 'carol', ONE),
    'NEW-BOB': account('b1', 'bob', TWO),
  }
  for (const server of [ONE, TWO]) {
    await page.route(`https://${server}/api/**`, (route) => {
      const path = new URL(route.request().url()).pathname
      const token = (route.request().headers()['authorization'] ?? '').replace(/^Bearer /, '')
      const body = path === '/api/v1/accounts/verify_credentials' ? byToken[token] ?? {} : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
  }
}

const settled = (page: Page) => page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await settled(page)
}

const accountMenu = (page: Page) => page.locator('caribou-nav-rail caribou-menu.account')
const accountTrigger = (page: Page) => accountMenu(page).locator('.trigger')
const handle = (key: string) => `@${key}`

const active = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('caribou.activeUserKey') ?? 'null') as string | null)
const stored = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('caribou.users') ?? '[]') as [string][]).map(([k]) => k))
const instanceCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((c) => c.name === 'caribou.instance')?.value

const deepActiveId = (page: Page) => page.evaluate(() => {
  let el: Element | null = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  return el?.id ?? null
})

const cookiePost = (page: Page) => page.waitForResponse((res: Response) =>
  res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/instance')

const documentLoad = (page: Page, path: string) => page.waitForResponse((res) =>
  res.request().resourceType() === 'document' && new URL(res.url()).pathname === path)

async function expectCookie(context: BrowserContext, posted: Response, server: string, browserName: string) {
  expect(posted.status()).toBe(204)
  expect(posted.request().postDataJSON()).toEqual({ server })
  expect(await posted.headerValue('set-cookie')).toMatch(new RegExp(`^caribou\\.instance=${server.replace(/\./g, '\\.')};`))
  // WebKit drops the Secure cookie that plain-http localhost sets.
  if (browserName !== 'webkit') expect(await instanceCookie(context)).toBe(server)
}

// Waits for the full page load a switch or sign-out ends with.
async function andLand(page: Page, path: string, act: () => Promise<void>): Promise<Response> {
  const loaded = documentLoad(page, path)
  const posted = cookiePost(page)
  await act()
  const res = await posted
  await loaded
  await page.waitForLoadState('load')
  await settled(page)
  return res
}

test('two accounts on two servers: add, switch, reload, sign out, 401', async ({ page, context, browserName }) => {
  // Carol (on Alice's server) is stored too, so that after Alice signs out
  // there is still an account that is not active, for the 401.
  await setup(page, context, [CAROL, ALICE])
  await authorizeSignsIn(page, ORIGIN, TWO, { token: 'NEW-BOB', server: TWO, userKey: BOB })
  await gotoSettled(page, '/home')
  await expect(accountTrigger(page)).toHaveAccessibleName(`Accounts alice ${handle(ALICE)}`)

  // 1. Add account, from the menu: a client-side navigation, not a load.
  const loads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') loads.push(new URL(req.url()).pathname + new URL(req.url()).search)
  })
  await accountTrigger(page).click()
  await accountMenu(page).getByRole('link', { name: 'Add account', exact: true }).click()
  await page.waitForURL((u) => u.pathname === '/' && u.searchParams.has('add'))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add an account')
  // The router renders the new page hidden next to the old one, then swaps.
  await expect(page.locator('caribou-landing')).toHaveCount(1)
  await expect(page.getByText(`You are signed in as ${handle(ALICE)}.`)).toBeVisible()
  // The router focuses its outlet after the swap; the field takes it back.
  await expect.poll(() => deepActiveId(page)).toBe('server')
  expect(loads).toEqual([])

  // 2. Sign in to Bob on the other server. The start sets the sign-in cookie.
  const start = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/signin/start')
  const bobCookie = cookiePost(page)
  await page.keyboard.type(TWO)
  await page.keyboard.press('Enter')
  const started = await start
  expect(started.request().postDataJSON()).toEqual({ server: TWO, add: true })
  expect(await started.headerValue('set-cookie')).toMatch(/^caribou\.signin=[A-Za-z0-9_-]{43}; .*Path=\/api\/signin/i)
  await page.waitForURL('**/home')
  await settled(page)
  await expectCookie(context, await bobCookie, TWO, browserName)

  // 3. The menu shows all accounts, Bob (new) current and first.
  expect(await active(page)).toBe(BOB)
  expect(await stored(page)).toEqual([CAROL, ALICE, BOB])
  await expect(accountTrigger(page)).toHaveAccessibleName(`Accounts bob ${handle(BOB)}`)
  await accountTrigger(page).click()
  const items = accountMenu(page).locator('.account-item')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toHaveAccessibleName(`Signed in as bob ${handle(BOB)}`)
  await expect(items.nth(0)).toHaveAttribute('aria-current', 'true')

  // 4. Switch to Alice: a reload as Alice, the cookie on her server.
  const toAlice = await andLand(page, '/home', () =>
    accountMenu(page).getByRole('button', { name: `Switch to alice ${handle(ALICE)}`, exact: true }).click())
  await expectCookie(context, toAlice, ONE, browserName)
  expect(await active(page)).toBe(ALICE)
  await expect(accountTrigger(page)).toHaveAccessibleName(`Accounts alice ${handle(ALICE)}`)

  // 5. A reload stays Alice; the cookie still names her server.
  await page.reload()
  await settled(page)
  expect(await active(page)).toBe(ALICE)
  await expect(accountTrigger(page)).toHaveAccessibleName(`Accounts alice ${handle(ALICE)}`)
  if (browserName !== 'webkit') expect(await instanceCookie(context)).toBe(ONE)

  // 6. Sign out of Alice: the next account (Bob) is active after the reload.
  await accountTrigger(page).click()
  const toBob = await andLand(page, '/home', () =>
    accountMenu(page).getByRole('button', { name: `Sign out of ${handle(ALICE)}`, exact: true }).click())
  await expectCookie(context, toBob, TWO, browserName)
  expect(await active(page)).toBe(BOB)
  expect(await stored(page)).toEqual([CAROL, BOB])
  await expect(accountTrigger(page)).toHaveAccessibleName(`Accounts bob ${handle(BOB)}`)

  // 7. A 401 for Carol (not active) removes only Carol: no reload, Bob stays.
  // Only the active account has a client, so the event a client sends on a
  // 401 stands in for the request (as in `unauthorized.spec.ts`).
  loads.length = 0
  await page.evaluate((userKey) => {
    window.dispatchEvent(new CustomEvent('caribou:unauthorized', { detail: { userKey, token: `TOKEN-${userKey}` } }))
  }, CAROL)
  await expect.poll(() => stored(page)).toEqual([BOB])
  expect(await active(page)).toBe(BOB)
  await accountTrigger(page).click()
  await expect(accountMenu(page).locator('.account-item')).toHaveCount(1)
  expect(loads).toEqual([])
  expect(new URL(page.url()).pathname).toBe('/home')
})

// Starts a sign-in to TWO in `page` and returns the callback URL with the
// state the server made, as the user's server would send it back.
async function startedCallback(page: Page): Promise<string> {
  let resolveUrl!: (url: string) => void
  const url = new Promise<string>((r) => { resolveUrl = r })
  await page.route(`https://${TWO}/oauth/authorize**`, (route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? ''
    resolveUrl(`/api/signin/callback?code=SOME-CODE&state=${encodeURIComponent(state)}`)
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>authorize</p>' })
  })
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill(TWO)
  await page.getByRole('button', { name: /sign in/i }).click()
  return url
}

// Where the callback sends `page`: the redirect's target, before the page
// that follows (which cleans the URL).
async function callbackTarget(page: Page, callback: string): Promise<URL> {
  const landed = page.waitForResponse((res) =>
    res.request().resourceType() === 'document' && new URL(res.url()).pathname === '/')
  await page.goto(callback)
  const url = new URL((await landed).url())
  // Let that page finish, so the next step's navigation does not cut it off.
  await page.waitForLoadState('load')
  await settled(page)
  return url
}

async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: ORIGIN })
  return { context, page: await context.newPage() }
}

test('a sign-in callback works only in the browser that started it', async ({ browser }) => {
  // The attacker starts a sign-in and keeps the callback URL.
  const attacker = await newPage(browser)
  const victim = await newPage(browser)
  try {
    // A browser that never started a sign-in has no `caribou.signin`
    // cookie: it stops before any token exchange, with its own message.
    const first = await startedCallback(attacker.page)
    const fresh = await callbackTarget(victim.page, first)
    expect(fresh.searchParams.get('error')).toBe('no_cookie')
    expect(await victim.page.evaluate(() => localStorage.getItem('caribou.users'))).toBeNull()

    // A browser with a sign-in of its own open has another nonce: it stops
    // at `state_mismatch`, also before any token exchange.
    await startedCallback(victim.page)
    const callback = await startedCallback(attacker.page)
    const there = await callbackTarget(victim.page, callback)
    expect(there.searchParams.get('error')).toBe('state_mismatch')
    expect(await victim.page.evaluate(() => localStorage.getItem('caribou.users'))).toBeNull()
    // The state is used up: the attacker cannot use it now either.
    expect((await callbackTarget(attacker.page, callback)).searchParams.get('error')).toBe('state_mismatch')

    // A fresh start, opened in the browser that started it, gets past the
    // binding check to the token exchange (which fails here: no real server).
    const own = await startedCallback(attacker.page)
    const home = await callbackTarget(attacker.page, own)
    expect(home.searchParams.get('error')).toBe('exchange_failed')
    expect(home.searchParams.get('instance')).toBe(TWO)
    // The callback spends the sign-in cookie.
    expect((await attacker.context.cookies()).find((c) => c.name === 'caribou.signin')).toBeUndefined()
  } finally {
    await attacker.context.close()
    await victim.context.close()
  }
})

test('a completion link someone sends signs nobody in', async ({ browser }) => {
  // The old way to finish a sign-in: the session in the URL fragment. A
  // stranger with a token for their own account could send this link.
  const link = `/signin/done#${new URLSearchParams({
    token: 'STRANGER-TOKEN', server: TWO, userKey: BOB, vapidKey: '',
  })}`

  // A browser with no account.
  const fresh = await newPage(browser)
  // A browser signed in as Alice.
  const alice = await newPage(browser)
  try {
    for (const { page } of [fresh, alice]) {
      if (page === alice.page) {
        await page.addInitScript((key) => {
          if (localStorage.getItem('caribou.__seeded__') === '1') return
          const session = { userKey: key, server: key.split('@')[1], token: 'TOKEN-A', vapidKey: '', account: null, createdAt: 0 }
          localStorage.setItem('caribou.users', JSON.stringify([[key, session]]))
          localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
          localStorage.setItem('caribou.__seeded__', '1')
        }, ALICE)
      }
      await page.goto(link)
      await expect(page.getByText(/something went wrong completing sign-in/i)).toBeVisible()
      await expect(page.getByRole('link', { name: 'Return to start' })).toHaveAttribute('href', '/')
      expect(new URL(page.url()).pathname).toBe('/signin/done')
    }
    expect(await fresh.page.evaluate(() => localStorage.getItem('caribou.users'))).toBeNull()
    expect(await fresh.page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))).toBeNull()
    expect(await stored(alice.page)).toEqual([ALICE])
    expect(await active(alice.page)).toBe(ALICE)
  } finally {
    await fresh.context.close()
    await alice.context.close()
  }
})
