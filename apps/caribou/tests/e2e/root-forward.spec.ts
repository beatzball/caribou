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
  await page.waitForTimeout(500)
  expect(pathname(page)).toBe('/')
})

test('signed in, a sign-in error on / stays, so the banner is seen', async ({ page, context }) => {
  await signIn(page, context)
  await gotoSettled(page, '/?error=denied')
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
  // The banner takes `?error=` out of the URL; the page still stays.
  await expect.poll(() => page.url()).not.toContain('error=')
  await page.waitForTimeout(500)
  expect(pathname(page)).toBe('/')
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
})

test('signed out, / stays the sign-in page', async ({ page }) => {
  await gotoSettled(page, '/')
  await expect(instanceField(page)).toBeVisible()
  await page.waitForTimeout(500)
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
  await page.waitForTimeout(500)
  expect(pathname(page)).toBe('/')
})

test('only / carries the forward script', async ({ request }) => {
  expect(await (await request.get('/')).text()).toContain('data-caribou-forward')
  expect(await (await request.get('/about')).text()).not.toContain('data-caribou-forward')
})
