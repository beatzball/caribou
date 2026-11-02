import { expect, test } from './_fixtures.js'

// On a phone, Settings is in the More menu (issue 49).

const INSTANCE = 'example.social'
const USER_KEY = `alice@${INSTANCE}`

test('More opens Settings', async ({ page, context }) => {
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
  await page.route(new RegExp(`https://${INSTANCE.replace('.', '\\.')}/api/`), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  const rail = page.locator('page-home caribou-nav-rail')
  // The bar shows it once: in the menu, not in the bar.
  await expect(rail.locator('nav > a[href="/settings"]')).toBeHidden()
  await rail.getByRole('button', { name: 'More' }).click()
  await rail.getByRole('link', { name: 'Settings' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await page.getByRole('radio', { name: 'Light' }).check()
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light')
})
