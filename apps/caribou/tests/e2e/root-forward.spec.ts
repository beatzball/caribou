import { expect, test, type BrowserContext, type Page } from './_fixtures.js'

// `/` goes to `/home` when an account is active (issue 135). The accounts
// live in the browser, so the check runs there: an inline script in the head
// of `/` before the first paint, and the page itself on a client-side
// navigation. Both replace `/`, so Back does not return to it.

const INSTANCE = 'example.social'
const USER_KEY = `alice@${INSTANCE}`

async function signIn(page: Page, context: BrowserContext) {
  await context.addCookies([{
    name: 'caribou.instance', value: INSTANCE, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  await page.addInitScript(({ userKey, instance }) => {
    if (localStorage.getItem('__caribou_test_seeded')) return
    localStorage.setItem('__caribou_test_seeded', '1')
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(userKey))
    localStorage.setItem('caribou.users',
      JSON.stringify([[userKey, { userKey, token: 'TOK', server: instance, vapidKey: 'VK' }]]))
  }, { userKey: USER_KEY, instance: INSTANCE })
  // The fake token must not get a 401, which would sign the reader out.
  await page.route(new RegExp(`https://${INSTANCE.replace('.', '\\.')}/api/`), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

const pathname = (page: Page) => new URL(page.url()).pathname
const instanceField = (page: Page) => page.getByLabel(/your mastodon instance/i)

test('signed in, opening / ends on /home, and Back does not return to /', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/about')
  await page.goto('/')
  await page.waitForURL('**/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('page-home')).toBeVisible()
  await expect(page.locator('caribou-landing')).toHaveCount(0)

  await page.goBack()
  await expect.poll(() => pathname(page)).toBe('/about')
})

test('signed in, a client-side navigation to / ends on /home, with no history entry for /', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/about')
  // What a link click does: `LitroRouter.go('/')`.
  await page.evaluate(() => {
    history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect.poll(() => pathname(page)).toBe('/home')
  await expect(page.locator('page-home')).toBeVisible()
  await expect(page.locator('caribou-landing')).toHaveCount(0)

  await page.goBack()
  await expect.poll(() => pathname(page)).toBe('/about')
})

test('signed in, /?add stays on the add-account form', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/?add')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add an account')
  // The outlet is settled, so the router entered / and kept it.
  expect(pathname(page)).toBe('/')
})

test('signed in, a sign-in error on / stays, so the banner is seen', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/?error=denied')
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
  // The banner takes `?error=` out of the URL; the page still stays.
  await expect.poll(() => page.url()).not.toContain('error=')
  expect(pathname(page)).toBe('/')
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
})

test('signed out, / stays the sign-in page', async ({ page }) => {
  await gotoSettled(page, '/')
  await expect(instanceField(page)).toBeVisible()
  expect(pathname(page)).toBe('/')
})

test('signing out of the last account lands on / and stays there', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/home')
  await page.locator('caribou-nav-rail').getByRole('button', { name: /^Accounts/ }).click()
  const signOut = page.locator('caribou-nav-rail caribou-menu.account caribou-signout-form button.signout-btn')
  await Promise.all([page.waitForURL((u) => u.pathname === '/'), signOut.click()])
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(instanceField(page)).toBeVisible()
  expect(pathname(page)).toBe('/')
})

test('only / carries the forward script', async ({ request }) => {
  expect(await (await request.get('/')).text()).toContain('data-caribou-root')
  expect(await (await request.get('/about')).text()).not.toContain('data-caribou-root')
})

// The banner removes a stashed error as it reads it. The page must still
// stay on / (the head script decided that) and show the banner.
test('signed in, a stashed sign-in error on / stays, so the banner is seen', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/about')
  await page.evaluate(() => sessionStorage.setItem('caribou.error', 'unauthorized'))
  await gotoSettled(page, '/')
  await expect(page.getByRole('alert')).toContainText(/your session expired/i)
  expect(pathname(page)).toBe('/')
  await expect(page.locator('page-home')).toHaveCount(0)
})

// The head script decides before the app runs: it ends `/` as hidden text
// while the parser is still in its head, so the landing is never parsed and
// the app (which would forward too, a moment later) never starts. Only the
// loading screen is there, and the browser paints it.
test('signed in, / leaves before the app or the landing runs', async ({ page, context }) => {
  await signIn(page, context)
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  let homeAsked!: () => void
  const asked = new Promise<void>((r) => { homeAsked = r })
  await page.route((u) => u.pathname === '/home', async (route) => {
    homeAsked()
    await held
    await route.continue()
  })
  // The `/` document reports what it holds while /home is held back. (A
  // page.evaluate would wait for the pending navigation.)
  const probes: string[] = []
  page.on('console', (m) => { if (m.text().startsWith('PROBE ')) probes.push(m.text().slice(6)) })
  await page.addInitScript(() => {
    if (location.pathname !== '/') return
    setInterval(() => console.warn('PROBE ' + JSON.stringify({
      splash: document.getElementById('caribou-splash') !== null,
      // Chromium paints nothing of a page whose parser a navigation stopped
      // in the head; the forward ends `/` as hidden text so the screen paints.
      painted: performance.getEntriesByType('paint').length > 0,
      // Any of the rest of `/` parsed as markup: the head's manifest link, the
      // router outlet, the page.
      landing: document.querySelector('link[rel="manifest"], litro-outlet, page-index') !== null,
      app: customElements.get('litro-outlet') !== undefined,
    })), 100)
  })
  await page.goto('/', { waitUntil: 'commit' })
  await asked
  await expect.poll(() => probes.length).toBeGreaterThan(2)
  expect(new Set(probes)).toEqual(new Set([JSON.stringify({ splash: true, painted: true, landing: false, app: false })]))
  release()
  await page.waitForURL('**/home')
  await expect(page.locator('page-home')).toBeVisible()
})

// The reader stops the load of /home (or it never comes). After 3 s the
// empty tab gets a way out.
test('signed in, a stopped /home load leaves links to go on', async ({ page, context }) => {
  await signIn(page, context)
  await page.route((u) => u.pathname === '/home', () => { /* never answers */ })
  await page.addInitScript(() => {
    if (location.pathname === '/') setTimeout(() => window.stop(), 1000)
  })
  await page.goto('/', { waitUntil: 'commit' })
  // The loading screen shows the way out after 3 s …
  const splash = page.locator('#caribou-splash')
  await expect(splash.getByRole('link', { name: 'Open your timeline' })).toBeVisible({ timeout: 6000 })
  await expect(splash.getByRole('link', { name: 'Open your timeline' })).toHaveAttribute('href', '/home')
  await expect(splash.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/?add')
  // … and a plain page with the same links takes its place at the limit.
  await expect(page.getByText('Opening your timeline…')).toBeVisible({ timeout: 12000 })
  await expect(splash).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Open your timeline' })).toHaveAttribute('href', '/home')
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/?add')
  expect(pathname(page)).toBe('/')
})

// A document first loaded at /?add keeps the head script's pageshow
// listener after a client-side move. Back from the back-forward cache, it
// must keep the page it is on.
test('a page that moved off /?add stays when restored from the back-forward cache', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/?add')
  await page.evaluate(() => {
    history.pushState(null, '', '/about')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect.poll(() => pathname(page)).toBe('/about')
  await page.locator('page-about').waitFor()
  // What the browser fires on a restore from the back-forward cache.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect(page.locator('page-about')).toBeVisible()
  expect(pathname(page)).toBe('/about')
})
