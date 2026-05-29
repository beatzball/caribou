import { expect, test } from '@playwright/test'

async function setupSignedIn(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
) {
  await context.addCookies([
    {
      name: 'caribou.instance',
      value: 'fosstodon.org',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])
  await page.addInitScript(() => {
    localStorage.setItem('caribou.activeUserKey', '"beatzball@fosstodon.org"')
    localStorage.setItem(
      'caribou.users',
      JSON.stringify([
        ['beatzball@fosstodon.org', { token: 'TOK', server: 'fosstodon.org', vapidKey: 'VK' }],
      ]),
    )
  })
  // Stub Mastodon calls so the fake token doesn't trigger Caribou's global
  // 401 -> removeActiveUser + redirect chain before the signout click fires.
  await page.route(/https:\/\/fosstodon\.org\/api\//, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

test('signout clears localStorage and preserves the instance cookie', async ({ page, context }) => {
  await setupSignedIn(page, context)

  await page.goto('/home')

  const signOut = page.locator('caribou-nav-rail').locator('button.signout-btn').first()
  await signOut.waitFor({ state: 'visible' })

  const signoutResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/signout') && r.status() === 204,
  )
  await signOut.click()
  await signoutResponse

  const cookies = await context.cookies()
  expect(cookies.find((c) => c.name === 'caribou.instance')?.value).toBe('fosstodon.org')

  const afterActive = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(afterActive).toBe('null')
})
