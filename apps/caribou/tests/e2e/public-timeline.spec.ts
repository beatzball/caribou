import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// Hits the real fosstodon.org via the server's SSR pageData fetch (no
// browser-level interception is possible because the fetch is in the
// nitro process). Skip in CI to avoid coupling builds to upstream
// uptime; run locally to verify the cookie-only public-timeline path.
//
// The server trusts the cookie only for an instance it has an OAuth app
// for: sign in once on this origin, or seed `apps:fosstodon.org:<origin>`
// in the server's STORAGE_DIR, before running these.
test.skip(!!process.env.CI, 'Hits real upstream; skip in CI')

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

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    // A remote avatar or a media host can fail on its own; only script
    // errors say something about hydration.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
      errors.push(`console: ${m.text()}`)
    }
  })
  return errors
}

async function settled(page: Page) {
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test('/local renders the cookie-instance public timeline without an active session', async ({ page, context }) => {
  await withInstanceCookie(context)
  await page.goto('/local')
  await page.waitForSelector('caribou-status-card', { timeout: 5000 })
  expect(await page.locator('caribou-status-card').count()).toBeGreaterThan(0)
  await expect(page.locator('text=No posts yet')).toHaveCount(0)
})

test('/public renders the cookie-instance public timeline without an active session', async ({ page, context }) => {
  await withInstanceCookie(context)
  await page.goto('/public')
  await page.waitForSelector('caribou-status-card', { timeout: 5000 })
  expect(await page.locator('caribou-status-card').count()).toBeGreaterThan(0)
})

for (const route of ['/local', '/public']) {
  test(`${route} hydrates real posts with no errors and keeps the server-rendered cards`, async ({ page, context, request }) => {
    await withInstanceCookie(context)
    const errors = collectErrors(page)

    // What the server sent, before any script ran.
    const body = await (await request.get(route, {
      headers: { Cookie: 'caribou.instance=fosstodon.org' },
    })).text()
    const serverCards = (body.match(/<caribou-status-card\s/g) ?? []).length
    expect(serverCards).toBeGreaterThan(0)

    await page.goto(route)
    await settled(page)

    // Lit throws on a server/client mismatch — including a difference
    // between the server's and the browser's sanitizer output for a post.
    expect(errors).toEqual([])
    await expect(page.locator('caribou-status-card article').first()).toBeVisible()
    expect(await page.locator('caribou-status-card').count()).toBeGreaterThanOrEqual(serverCards)
    await expect(page.locator('text=No posts yet')).toHaveCount(0)

    // The card switched from the server's absolute timestamp to the
    // relative form ("5m", "2h", "3d", "Apr 14", "just now").
    await expect(page.locator('caribou-status-card time').first())
      .toHaveText(/^\s*(just now|\d+[mhd]|[A-Z][a-z]{2} \d{1,2}(, \d{4})?)\s*$/)
  })
}

test('/local shows painted cards on every frame while JavaScript takes over', async ({ page, context }) => {
  await withInstanceCookie(context)
  // From the moment the server HTML is parsed, count on every animation
  // frame the cards that are both rendered (have their <article>) and
  // visible. Hydration and the router's page swap must never drop it to 0.
  await page.addInitScript(() => {
    const samples: number[] = []
    ;(window as unknown as { __paintedCards: number[] }).__paintedCards = samples
    const sample = () => {
      let painted = 0
      for (const pageEl of document.querySelectorAll('litro-outlet > *')) {
        const timeline = pageEl.shadowRoot?.querySelector('caribou-timeline')
        for (const card of timeline?.shadowRoot?.querySelectorAll('caribou-status-card') ?? []) {
          if (card.shadowRoot?.querySelector('article') && card.checkVisibility()) painted++
        }
      }
      samples.push(painted)
      requestAnimationFrame(sample)
    }
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(sample))
  })
  await page.goto('/local')
  await settled(page)
  // A few more frames after the swap.
  await page.waitForTimeout(300)
  const samples = await page.evaluate(() => (window as unknown as { __paintedCards: number[] }).__paintedCards)
  expect(samples.length).toBeGreaterThan(5)
  expect(Math.min(...samples)).toBeGreaterThan(0)
})

test('/local keeps a working Older posts link when no user is signed in', async ({ page, context }) => {
  await withInstanceCookie(context)
  await page.goto('/local')
  await settled(page)
  const cardIds = () => page.locator('caribou-status-card').evaluateAll(
    (cards) => cards.map((c) => (c as HTMLElement).dataset.statusId),
  )
  const firstPage = await cardIds()

  // With no signed-in client the timeline cannot fetch in place. Scrolling
  // the link into view must not make it vanish…
  const older = page.locator('page-local a[data-sentinel]')
  await older.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await expect(older).toBeVisible()

  // …and a click loads the next server-rendered page.
  await older.click()
  await expect(page).toHaveURL(/\/local\?max_id=/)
  await settled(page)
  const secondPage = await cardIds()
  expect(secondPage.length).toBeGreaterThan(0)
  for (const id of secondPage) expect(firstPage).not.toContain(id)
})

test('nav rail goes from /local to /public without a full page load', async ({ page, context }) => {
  await withInstanceCookie(context)
  const errors = collectErrors(page)
  await page.goto('/local')
  await settled(page)
  await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true })

  await page.locator('caribou-nav-rail').getByRole('link', { name: 'Public' }).click()
  await expect(page).toHaveURL(/\/public$/)
  await expect(page.locator('page-public caribou-timeline[kind="public"] caribou-status-card').first()).toBeVisible()
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  expect(errors).toEqual([])
})
