import { COMPLETE_PAGE_CSP, completeSigninPage } from '../../server/lib/signin-complete-page.js'
import { expect, test, type BrowserContext, type Page } from './_fixtures.js'

// /settings (issue 49): theme, default timeline, and the account. The
// settings are per account, in `caribou.prefs.<userKey>`.

const INSTANCE = 'example.social'
const USER_KEY = `alice@${INSTANCE}`
const PREFS = `caribou.prefs.${USER_KEY}`
const LIGHT_BG = 'rgb(250, 250, 250)'
const DARK_BG = 'rgb(13, 13, 18)'

const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice A',
  avatar: '', avatar_static: '', url: `https://${INSTANCE}/@alice`, header: '', header_static: '',
  note: '', followers_count: 0, following_count: 0, statuses_count: 0, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

// Seeds one session, once per test, and optional prefs for it.
async function signIn(page: Page, context: BrowserContext, prefs?: Record<string, unknown>) {
  await context.addCookies([{
    name: 'caribou.instance', value: INSTANCE, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  await page.addInitScript(({ userKey, instance, prefsKey, prefs }) => {
    if (localStorage.getItem('__caribou_test_seeded')) return
    localStorage.setItem('__caribou_test_seeded', '1')
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(userKey))
    localStorage.setItem('caribou.users',
      JSON.stringify([[userKey, { userKey, token: 'TOK', server: instance, vapidKey: 'VK', account: null, createdAt: 1 }]]))
    if (prefs) localStorage.setItem(prefsKey, JSON.stringify(prefs))
  }, { userKey: USER_KEY, instance: INSTANCE, prefsKey: PREFS, prefs: prefs ?? null })
  // The fake token must not get a 401, which would sign the reader out.
  await page.route(new RegExp(`https://${INSTANCE.replace('.', '\\.')}/api/`), (route) => {
    const path = new URL(route.request().url()).pathname
    const body = path === '/api/v1/accounts/verify_credentials' ? ACCOUNT : []
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

// Records, before any of the app's code runs, the theme on <html> when the
// parser first reaches <body>, and the page colour on the first frame that
// has a body. Both must already be the chosen theme: then no frame was
// painted in the other one.
async function watchFirstPaint(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __firstPaint?: { theme: string | null; bg: string } }
    const seen: { theme: string | null; bg: string } = { theme: 'unset', bg: '' }
    w.__firstPaint = seen
    new MutationObserver((_, obs) => {
      if (!document.body) return
      seen.theme = document.documentElement.getAttribute('data-theme')
      obs.disconnect()
    }).observe(document, { childList: true, subtree: true })
    const frame = () => {
      if (!document.body) { requestAnimationFrame(frame); return }
      seen.bg = getComputedStyle(document.body).backgroundColor
    }
    requestAnimationFrame(frame)
  })
}

const firstPaint = (page: Page) =>
  page.evaluate(() => (window as unknown as { __firstPaint: { theme: string | null; bg: string } }).__firstPaint)

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const htmlTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
const storedPrefs = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, unknown>, PREFS)

// Errors in the console: a failed hydration logs one.
function consoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => { errors.push(e.message) })
  return errors
}

test('the rail links to Settings, and the page shows its sections', async ({ page, context }) => {
  await signIn(page, context)
  const errors = consoleErrors(page)
  await gotoSettled(page, '/home')
  await page.locator('page-home caribou-nav-rail').getByRole('link', { name: 'Settings', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  for (const name of ['Appearance', 'Timeline', 'Account']) {
    await expect(page.getByRole('region', { name })).toBeVisible()
  }
  await expect(page.locator('page-settings caribou-nav-rail nav > a[href="/settings"]')).toHaveAttribute('aria-current', 'page')
  expect(errors).toEqual([])
})

test('signed out, /settings asks to sign in', async ({ page }) => {
  await gotoSettled(page, '/settings')
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page.locator('caribou-settings')).toHaveCount(0)
})

test('choosing light applies it at once and saves it', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/settings')
  expect(await bodyBg(page)).toBe(DARK_BG)
  await page.getByRole('radio', { name: 'Light' }).check()
  await expect.poll(() => htmlTheme(page)).toBe('light')
  expect(await bodyBg(page)).toBe(LIGHT_BG)
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#fafafa')
  expect((await storedPrefs(page)).theme).toBe('light')

  await page.getByRole('radio', { name: 'Dark' }).check()
  await expect.poll(() => htmlTheme(page)).toBe('dark')
  expect(await bodyBg(page)).toBe(DARK_BG)
})

test('a light page paints light from the first frame, and hydrates', async ({ page, context }) => {
  await signIn(page, context, { theme: 'light' })
  await watchFirstPaint(page)
  const errors = consoleErrors(page)
  for (const path of ['/settings', '/home', '/about']) {
    await gotoSettled(page, path)
    expect(await firstPaint(page)).toEqual({ theme: 'light', bg: LIGHT_BG })
  }
  // The settings page shows the saved choice.
  await gotoSettled(page, '/settings')
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked()
  expect(errors).toEqual([])
})

test('a dark page paints dark from the first frame', async ({ page, context }) => {
  await signIn(page, context)
  await watchFirstPaint(page)
  await gotoSettled(page, '/home')
  expect(await firstPaint(page)).toEqual({ theme: 'dark', bg: DARK_BG })
})

test('system follows the device, also while the page is open', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await signIn(page, context, { theme: 'system' })
  await watchFirstPaint(page)
  await gotoSettled(page, '/settings')
  expect(await firstPaint(page)).toEqual({ theme: 'light', bg: LIGHT_BG })
  await expect(page.getByRole('radio', { name: /System/ })).toBeChecked()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => htmlTheme(page)).toBe('dark')
  expect(await bodyBg(page)).toBe(DARK_BG)
})

test('pages outside the app shell paint the chosen theme too', async ({ page, context }) => {
  await signIn(page, context, { theme: 'light' })
  await watchFirstPaint(page)

  const notFound = await page.goto('/no-such-page')
  expect(notFound?.status()).toBe(404)
  expect(await firstPaint(page)).toEqual({ theme: 'light', bg: LIGHT_BG })

  await page.goto('/signin/done')
  expect(await firstPaint(page)).toEqual({ theme: 'light', bg: LIGHT_BG })

  // The sign-in completion page, under its own strict CSP. An empty token
  // makes its script show the fallback and stay, so the page can be looked at.
  const errors = consoleErrors(page)
  const origin = new URL(page.url()).origin
  await page.route(`${origin}/api/signin/callback?code=E2E-OK**`, (route) => route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': COMPLETE_PAGE_CSP },
    body: completeSigninPage({ token: '', server: INSTANCE, userKey: USER_KEY, vapidKey: '' }),
  }))
  await page.goto('/api/signin/callback?code=E2E-OK&state=S')
  // The page's own script ran (the CSP let it) and showed the fallback.
  await expect(page.getByText('Something went wrong completing sign-in.')).toBeVisible()
  expect(await firstPaint(page)).toEqual({ theme: 'light', bg: LIGHT_BG })
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#fafafa')
  // No script or style was refused by the CSP.
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([])
})

// Every read and write of localStorage throws, as in a browser that blocks
// site data.
async function blockStorage(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError') } })
  })
}

test('blocked storage leaves the dark theme and the page works', async ({ page }) => {
  await blockStorage(page)
  await watchFirstPaint(page)
  await page.goto('/about')
  expect(await firstPaint(page)).toEqual({ theme: 'dark', bg: DARK_BG })
})

test('with storage blocked, Settings shows the defaults and says they cannot be saved', async ({ page }) => {
  await blockStorage(page)
  const errors: string[] = []
  page.on('pageerror', (e) => { errors.push(e.message) })

  // A full load.
  await gotoSettled(page, '/settings')
  await expect(page.getByText(/cannot save settings here/)).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Home' })).toBeChecked()
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.getByRole('region', { name: 'Appearance' }).getByRole('status')).toHaveText(/Not saved/)
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  expect(await htmlTheme(page)).toBe('dark')

  // A client-side navigation: the router must show the page.
  await gotoSettled(page, '/about')
  await page.locator('page-about caribou-nav-rail nav > a[href="/settings"]').click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings')
  await expect(page.locator('page-settings')).toBeVisible()
  await expect(page.locator('page-about')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  expect(errors).toEqual([])
})

test('a refused save puts the control back and says so', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/settings')
  // Storage is full: reads work, writes do not.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
  })
  await page.getByRole('radio', { name: 'Public' }).click()
  await expect(page.getByRole('region', { name: 'Timeline' }).getByRole('status')).toHaveText(/Not saved/)
  await expect(page.getByRole('radio', { name: 'Home' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Public' })).not.toBeChecked()
})

test('/settings#<id> opens at that section', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 400 })
  await signIn(page, context)
  await gotoSettled(page, '/settings#account')
  await expect(page.getByRole('heading', { level: 2, name: 'Account' })).toBeInViewport()
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).not.toBeInViewport()
})

test('the default timeline is where / goes', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/settings')
  await expect(page.getByRole('radio', { name: 'Home' })).toBeChecked()
  await page.getByRole('radio', { name: 'Local' }).check()
  expect((await storedPrefs(page)).defaultTimeline).toBe('local')

  // A full load of `/`: the head script.
  await page.goto('/')
  await page.waitForURL('**/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('page-local')).toBeAttached()

  // A client-side navigation to `/`, from another page: the page's own check.
  const errors = consoleErrors(page)
  await gotoSettled(page, '/about')
  await page.evaluate(() => {
    history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect.poll(() => new URL(page.url()).pathname).toBe('/local')
  await expect(page.locator('page-local')).toBeVisible()
  await expect(page.locator('page-about')).toHaveCount(0)
  await expect(page.locator('caribou-landing')).toHaveCount(0)
  await expect(page.locator('page-index')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('signing in again to an account that chose a timeline opens that timeline', async ({ page, context }) => {
  await signIn(page, context, { defaultTimeline: 'public' })
  await gotoSettled(page, '/about')
  const origin = new URL(page.url()).origin
  await page.route(`${origin}/api/signin/callback?code=E2E-OK**`, (route) => route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': COMPLETE_PAGE_CSP },
    body: completeSigninPage({ token: 'TOK2', server: INSTANCE, userKey: USER_KEY, vapidKey: '' }),
  }))
  await page.goto('/api/signin/callback?code=E2E-OK&state=S')
  await page.waitForURL('**/public')
})

test('the account section shows who is signed in and signs out of this account', async ({ page, context }) => {
  await signIn(page, context, { theme: 'light' })
  await gotoSettled(page, '/settings')
  const account = page.getByRole('region', { name: 'Account' })
  await expect(account.getByText('Alice A')).toBeVisible()
  await expect(account.getByText('@alice@example.social', { exact: true })).toBeVisible()
  await expect(account.getByRole('link', { name: 'Your profile' })).toHaveAttribute('href', '/@me')
  await expect(account.getByRole('link', { name: 'Add account' })).toHaveAttribute('href', '/?add')
  await account.getByRole('button', { name: 'Sign out of @alice@example.social' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('caribou.users'))).toBe('[]')
  // The prefs went with the account, so the theme is the default again.
  expect(await page.evaluate((k) => localStorage.getItem(k), PREFS)).toBeNull()
  await expect.poll(() => htmlTheme(page)).toBe('dark')
})
