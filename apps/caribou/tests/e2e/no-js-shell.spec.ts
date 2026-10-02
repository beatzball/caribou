import { expect, test } from '@playwright/test'

// With JavaScript off, the declarative shadow roots are all the browser gets.
// Everything a visitor needs to read or follow must already be in them.
test.use({ javaScriptEnabled: false })

test('landing page shows the heading and the sign-in form', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Caribou')
  await expect(page.getByText('A Mastodon client. Enter your instance to sign in.')).toBeVisible()
  await expect(page.getByLabel(/your mastodon instance/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('privacy page shows its text inside the shell, with real links', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy')
  await expect(page.getByText(/does not collect analytics or\s+telemetry/i)).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Primary' })
  for (const [name, href] of [['Home', '/home'], ['Local', '/local'], ['Public', '/public'], ['Profile', '/@me']] as const) {
    await expect(nav.getByRole('link', { name })).toHaveAttribute('href', href)
  }
  await expect(nav.locator('form[action="/api/signout"][method="post"] button[type="submit"]')).toHaveCount(1)
})

test('a shell link is followed as a full page load', async ({ page }) => {
  await page.goto('/privacy')
  await page.locator('caribou-right-rail').getByRole('link', { name: 'About' }).click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About')
})

test('blog links work', async ({ page }) => {
  await page.goto('/blog')
  await page.getByRole('link', { name: 'Hello World' }).click()
  await expect(page).toHaveURL(/\/blog\/hello-world$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Post: hello-world')
})
