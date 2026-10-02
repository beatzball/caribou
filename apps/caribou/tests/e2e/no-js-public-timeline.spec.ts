import { expect, test, type BrowserContext } from '@playwright/test'

// Hits real fosstodon.org via the server's SSR pageData fetch. Skip in CI
// to avoid coupling builds to upstream uptime; run locally to verify the
// no-JS path renders cards and pagination from cookie alone. (See
// public-timeline.spec.ts for the storage the server needs.)
test.skip(!!process.env.CI, 'Hits real upstream; skip in CI')

test.use({ javaScriptEnabled: false })

async function withInstanceCookie(context: BrowserContext) {
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
}

for (const route of ['/local', '/public']) {
  test(`${route} renders status cards with JS disabled`, async ({ page, context }) => {
    await withInstanceCookie(context)
    await page.goto(route)
    // No JS = no hydration; the server markup is final.
    await page.waitForSelector('caribou-status-card', { timeout: 5000 })
    const count = await page.locator('caribou-status-card').count()
    expect(count).toBeGreaterThan(0)
    await expect(page.locator('text=No posts yet')).toHaveCount(0)
    // The cards are painted, not empty shells: author, permalink, timestamp.
    const first = page.locator('caribou-status-card').first()
    await expect(first.locator('article')).toBeVisible()
    await expect(first.locator('header strong')).not.toBeEmpty()
    await expect(first.locator('a.permalink time')).toBeVisible()
    await expect(first.locator('a.permalink')).toHaveAttribute('href', /^\/@[^/]+\/.+/)
  })
}

test('/local Older posts anchor links to ?max_id=… without JS', async ({ page, context }) => {
  await withInstanceCookie(context)
  await page.goto('/local')
  const anchor = page.locator('a[rel="next"][data-sentinel]')
  await expect(anchor).toBeVisible()
  const href = await anchor.getAttribute('href')
  // The server emits a query-only `?max_id=…`; the browser resolves it
  // against the current /local URL on click.
  expect(href).toMatch(/^(\/local)?\?max_id=/)
})

test('/local Older posts anchor loads the next server-rendered page without JS', async ({ page, context }) => {
  await withInstanceCookie(context)
  await page.goto('/local')
  const ids = () => page.locator('caribou-status-card').evaluateAll(
    (cards) => cards.map((c) => (c as HTMLElement).dataset.statusId),
  )
  // `evaluateAll` runs through the debugger protocol; it does not need page JS.
  const firstPage = await ids()
  await page.locator('a[rel="next"][data-sentinel]').click()
  await expect(page).toHaveURL(/\/local\?max_id=/)
  await page.waitForSelector('caribou-status-card', { timeout: 5000 })
  const secondPage = await ids()
  expect(secondPage.length).toBeGreaterThan(0)
  for (const id of secondPage) expect(firstPage).not.toContain(id)
})
