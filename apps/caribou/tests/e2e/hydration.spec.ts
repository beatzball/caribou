import { expect, test, type Page } from '@playwright/test'

// Lit throws when the first client render differs from the server HTML. The
// throw surfaces as a page error (or a console error), so a clean load of each
// route is the real-browser check of server/client parity.
// With no instance cookie the three timeline routes render their
// auth-required placeholder, so they need no upstream.
const ROUTES = [
  '/', '/?error=denied', '/about', '/privacy', '/blog', '/blog/hello-world',
  '/home', '/local', '/public',
]

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

for (const route of ROUTES) {
  test(`${route} hydrates and settles with no errors`, async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto(route)
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    // Exactly one page element is left after the router's swap.
    await expect(page.locator('litro-outlet > *')).toHaveCount(1)
    expect(errors).toEqual([])
  })
}

// The server does not know the request path, so the nav rail renders no
// active item; it marks one from `location` after its first update.
test('the nav rail marks the active item with aria-current after hydration', async ({ page, request }) => {
  const body = await (await request.get('/local')).text()
  expect(body).not.toMatch(/<a [^>]*aria-current=/)

  await page.goto('/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  const localNav = page.locator('page-local caribou-nav-rail')
  await expect(localNav.getByRole('link', { name: 'Local' })).toHaveAttribute('aria-current', 'page')
  await expect(localNav.locator('a[aria-current]')).toHaveCount(1)

  // The mark follows a client-side navigation. The old and the new page
  // share the outlet for a moment, so scope to the page that is expected.
  await localNav.getByRole('link', { name: 'Public' }).click()
  await expect(page).toHaveURL(/\/public$/)
  const publicNav = page.locator('page-public caribou-nav-rail')
  await expect(publicNav.getByRole('link', { name: 'Public' })).toHaveAttribute('aria-current', 'page')
  await expect(publicNav.locator('a[aria-current]')).toHaveCount(1)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
})

// During a client-side navigation the router holds the old and the new page
// in the outlet for a moment, so these tests scope their locators to the page
// they expect and then check that only one page is left.
test('a shell link navigates without a full page load', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/about')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true })

  await page.locator('caribou-right-rail').getByRole('link', { name: 'Privacy' }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.locator('page-privacy').getByRole('heading', { level: 1 })).toHaveText('Privacy')
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  expect(errors).toEqual([])
})

test('blog index → post → back, client-side, with the post data', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/blog')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true })

  await page.getByRole('link', { name: 'Getting Started' }).click()
  await expect(page).toHaveURL(/\/blog\/getting-started$/)
  await expect(page.locator('page-blog-slug').getByRole('heading', { level: 1 })).toHaveText('Post: getting-started')
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(page.getByText('This is the content for the "getting-started" post.')).toBeVisible()

  await page.getByRole('link', { name: /back to blog/i }).click()
  await expect(page).toHaveURL(/\/blog$/)
  await expect(page.locator('page-blog').getByRole('heading', { level: 1 })).toHaveText('Blog')
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  expect(errors).toEqual([])
})
