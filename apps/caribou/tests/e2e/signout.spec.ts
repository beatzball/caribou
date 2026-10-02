import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// Where the signed-in user starts. Any page inside the app shell works: the
// sign-out button lives in the nav rail.
const START_PATH = '/about'

const INSTANCE = 'example.social'
const USER_KEY = `alice@${INSTANCE}`

async function setupSignedIn(page: Page, context: BrowserContext) {
  await context.addCookies([
    {
      name: 'caribou.instance',
      value: INSTANCE,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])
  await page.addInitScript(
    ({ userKey, instance }) => {
      if (localStorage.getItem('__caribou_test_seeded')) return
      localStorage.setItem('__caribou_test_seeded', '1')
      localStorage.setItem('caribou.activeUserKey', JSON.stringify(userKey))
      localStorage.setItem(
        'caribou.users',
        JSON.stringify([[userKey, { token: 'TOK', server: instance, vapidKey: 'VK' }]]),
      )
    },
    { userKey: USER_KEY, instance: INSTANCE },
  )
  // Stub Mastodon calls so the fake token doesn't trigger Caribou's global
  // 401 -> removeActiveUser + redirect chain before the signout click fires.
  await page.route(new RegExp(`https://${INSTANCE.replace('.', '\\.')}/api/`), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

test('signout clears localStorage, preserves the instance cookie, and redirects to /', async ({ page, context }) => {
  await setupSignedIn(page, context)

  await gotoSettled(page, START_PATH)

  const signOut = page.locator('caribou-nav-rail').locator('button.signout-btn').first()
  await signOut.waitFor({ state: 'visible' })

  const signoutPost = page.waitForRequest(
    (req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/signout',
  )
  await Promise.all([
    page.waitForURL('**/', { timeout: 5000 }),
    signOut.click(),
  ])
  await signoutPost

  const cookies = await context.cookies()
  expect(cookies.find((c) => c.name === 'caribou.instance')?.value).toBe(INSTANCE)

  const afterActive = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(afterActive).toBe('null')

  await expect(page.locator('caribou-landing')).toHaveCount(1)
})

// The right rail's "Signed in to …" line needs an instance the server has an
// app registration for, which an e2e run does not have; the component test
// covers that line. The host attribute below is what both rails key off.
test('with a session, neither rail is [signed-out] and sign-out is offered', async ({ page, context }) => {
  await setupSignedIn(page, context)
  await gotoSettled(page, START_PATH)

  await expect(page.locator('caribou-nav-rail')).not.toHaveAttribute('signed-out', /.*/)
  await expect(page.locator('caribou-right-rail')).not.toHaveAttribute('signed-out', /.*/)
  await expect(page.locator('caribou-nav-rail button.signout-btn')).toBeVisible()
})

test('without a session, both rails are [signed-out] and sign-out is hidden', async ({ page }) => {
  await gotoSettled(page, START_PATH)

  await expect(page.locator('caribou-nav-rail')).toHaveAttribute('signed-out', '')
  await expect(page.locator('caribou-right-rail')).toHaveAttribute('signed-out', '')
  await expect(page.locator('caribou-nav-rail button.signout-btn')).toBeHidden()
})
