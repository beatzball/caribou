import AxeBuilder from '@axe-core/playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Response } from '@playwright/test'
import { expect, test, type BrowserContext, type Page } from './_fixtures.js'

// "Add account" while signed in (#58, phase 3). The account menu links to
// `/?add`: a sign-in form that keeps the accounts already stored.
//
// The real sign-in runs to the user's server and back. The token exchange
// is a request from this server to that one, which a test cannot answer, so
// a successful sign-in jumps from the authorize page straight to
// `/signin/done` with a token, as the server would. A denial goes through
// the real `/api/signin/callback`.

// Sign-in start and the cookie endpoint need an app registered for the
// server, so the test writes registrations into the server's storage (as
// `accounts.spec.ts` does).
test.skip(!!process.env.E2E_BASE_URL && !process.env.E2E_STORAGE_DIR,
  'Needs E2E_STORAGE_DIR to seed app registrations for an external server')
test.describe.configure({ mode: 'serial' })

const ONE = 'e2e-add-one.example'
const TWO = 'e2e-add-two.example'
const ALICE = `alice@${ONE}`
const BOB = `bob@${TWO}`
const STORAGE = resolve(process.env.E2E_STORAGE_DIR ?? process.env.STORAGE_DIR ?? './.data')
const ORIGIN = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin

// The storage key is `apps:<server>:<origin>`; the fs driver turns every `:`
// into a folder, so `http://localhost:3317` becomes `http/localhost/3317`.
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

interface Stored { userKey: string; server: string; token: string }

async function setup(page: Page, context: BrowserContext, keys: string[]) {
  await context.addCookies([{
    name: 'caribou.instance', value: ONE, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  const sessions = keys.map((userKey, i) => ({
    userKey, server: userKey.slice(userKey.indexOf('@') + 1),
    token: `TOKEN-${i}`, vapidKey: '', account: null, createdAt: i,
  }))
  await page.addInitScript((data) => {
    if (localStorage.getItem('caribou.__seeded__') === '1') return
    localStorage.setItem('caribou.users', JSON.stringify(data.sessions.map((s) => [s.userKey, s])))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.sessions.at(-1)!.userKey))
    localStorage.setItem('caribou.__seeded__', '1')
  }, { sessions })
  for (const [server, acct] of [[ONE, account('a1', 'alice', ONE)], [TWO, account('b1', 'bob', TWO)]] as const) {
    await page.route(`https://${server}/api/**`, (route) => {
      const path = new URL(route.request().url()).pathname
      const body = path === '/api/v1/accounts/verify_credentials' ? acct : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
  }
}

// The user's server: its authorize page sends the browser on at once, to
// `next(state)`. A plain page with a script, as a redirect from a mocked
// response is not followed the same way in every browser.
async function authorizeThen(page: Page, server: string, next: (state: string) => string) {
  await page.route(`https://${server}/oauth/authorize**`, (route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? ''
    return route.fulfill({
      status: 200, contentType: 'text/html',
      body: `<!doctype html><script>location.replace(${JSON.stringify(ORIGIN + next(state))})</script>`,
    })
  })
}

const signedInWith = (token: string, server: string, userKey: string) => () =>
  `/signin/done#${new URLSearchParams({ token, server, userKey, vapidKey: '' })}`

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

const field = (page: Page) => page.getByLabel(/your mastodon instance/i)

async function addAccount(page: Page, server: string): Promise<Record<string, unknown>> {
  const start = page.waitForRequest((req) => new URL(req.url()).pathname === '/api/signin/start')
  await field(page).fill(server)
  await page.getByRole('button', { name: /sign in/i }).click()
  return (await start).postDataJSON() as Record<string, unknown>
}

const active = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('caribou.activeUserKey') ?? 'null') as string | null)
const stored = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('caribou.users') ?? '[]') as [string, Stored][]).map(([, s]) => s))
const instanceCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((c) => c.name === 'caribou.instance')?.value

const deepActiveId = (page: Page) => page.evaluate(() => {
  let el: Element | null = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  return el?.id ?? null
})

// After the sign-in lands on /home, the app points the cookie at the new
// account's server (it named the old one).
const cookiePost = (page: Page) => page.waitForResponse((res: Response) =>
  res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/instance')

async function expectCookie(context: BrowserContext, posted: Response, server: string, browserName: string) {
  expect(posted.status()).toBe(204)
  expect(posted.request().postDataJSON()).toEqual({ server })
  expect(await posted.headerValue('set-cookie')).toMatch(new RegExp(`^caribou\\.instance=${server.replace(/\./g, '\\.')};`))
  // WebKit drops the Secure cookie that plain-http localhost sets.
  if (browserName !== 'webkit') expect(await instanceCookie(context)).toBe(server)
}

test('the add form names the signed-in account, focuses the field and has Cancel', async ({ page, context }) => {
  await setup(page, context, [ALICE])
  await gotoSettled(page, '/?add')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add an account')
  await expect(page.getByText(`You are signed in as @alice@${ONE}.`)).toBeVisible()
  await expect.poll(() => deepActiveId(page)).toBe('server')
  const cancel = page.getByRole('link', { name: 'Cancel' })
  await expect(cancel).toHaveAttribute('href', '/home')
  await cancel.click()
  await page.waitForURL('**/home')
  expect(await active(page)).toBe(ALICE)
})

test('add a second account on another server: both stored, the new one active, cookie on its server', async ({ page, context, browserName }) => {
  await setup(page, context, [ALICE])
  await authorizeThen(page, TWO, signedInWith('NEW-BOB', TWO, BOB))
  await gotoSettled(page, '/?add')

  const posted = cookiePost(page)
  expect(await addAccount(page, TWO)).toEqual({ server: TWO, add: true })
  await page.waitForURL('**/home')
  await expectCookie(context, await posted, TWO, browserName)

  expect(await active(page)).toBe(BOB)
  expect((await stored(page)).map((s) => [s.userKey, s.token])).toEqual([[ALICE, 'TOKEN-0'], [BOB, 'NEW-BOB']])
})

test('add the same account again: no duplicate, the new token replaces the old, it becomes active', async ({ page, context, browserName }) => {
  await setup(page, context, [ALICE, BOB])
  await authorizeThen(page, ONE, signedInWith('NEW-ALICE', ONE, ALICE))
  // Bob is active, and the cookie names Alice's server: put it on Bob's
  // first, so the sign-in has to move it back.
  await context.addCookies([{
    name: 'caribou.instance', value: TWO, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  await gotoSettled(page, '/?add')
  await expect(page.getByText(`You are signed in as @bob@${TWO}.`)).toBeVisible()

  const posted = cookiePost(page)
  await addAccount(page, ONE)
  await page.waitForURL('**/home')
  await expectCookie(context, await posted, ONE, browserName)

  expect(await active(page)).toBe(ALICE)
  expect((await stored(page)).map((s) => [s.userKey, s.token])).toEqual([[ALICE, 'NEW-ALICE'], [BOB, 'TOKEN-1']])
})

test('a denied authorize goes back to the add form; the accounts and the active one stay', async ({ page, context }) => {
  await setup(page, context, [ALICE])
  await authorizeThen(page, TWO, (state) => `/api/signin/callback?error=access_denied&state=${encodeURIComponent(state)}`)
  await gotoSettled(page, '/?add')

  const back = page.waitForResponse((res) =>
    res.request().resourceType() === 'document' && new URL(res.url()).pathname === '/'
    && new URL(res.url()).searchParams.get('error') === 'denied')
  await addAccount(page, TWO)
  const landed = new URL((await back).url())
  expect(landed.searchParams.has('add')).toBe(true)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add an account')
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
  await expect(page.getByText(`You are signed in as @alice@${ONE}.`)).toBeVisible()
  // The error leaves the URL; `add` stays (as `?add=`).
  await expect.poll(() => new URL(page.url()).searchParams.has('error')).toBe(false)
  expect(new URL(page.url()).searchParams.has('add')).toBe(true)
  expect(await active(page)).toBe(ALICE)
  expect((await stored(page)).map((s) => s.userKey)).toEqual([ALICE])

  await page.getByRole('link', { name: 'Cancel' }).click()
  await page.waitForURL('**/home')
  expect(await active(page)).toBe(ALICE)
})

test('the add form has no a11y violations', async ({ page, context }) => {
  await setup(page, context, [ALICE])
  await gotoSettled(page, '/?add')
  await expect(page.getByText(`You are signed in as @alice@${ONE}.`)).toBeVisible()
  const results = await new AxeBuilder({ page })
    .disableRules(['landmark-one-main', 'page-has-heading-one'])
    .analyze()
  expect(results.violations).toEqual([])
})
