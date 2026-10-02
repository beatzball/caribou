import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { livePage, serverPageReport, watchServerPage } from './_server-page.js'

// The router hydrates the server-rendered page, builds a second one, then
// swaps them. Until the swap, the visible page is not the live one.
async function settled(page: Page) {
  await page.waitForSelector('litro-outlet[data-litro-settled]', { state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test('/@handle/id without a home instance: shows the instance placeholder', async ({ page }) => {
  await page.goto('/@alice@example.social/123')
  await settled(page)
  await expect(page.getByText('Threads by bare handle need to know which instance to query.')).toBeVisible()
  await expect(page.locator('caribou-thread')).toHaveCount(0)
})

// These hit the real fosstodon.org through the server's pageData fetch; no
// browser-level interception can reach a request made in the nitro process.
// Skipped in CI so a build does not depend on upstream uptime.
test.describe('/@handle/id — server-rendered thread (real upstream)', () => {
  test.skip(!!process.env.CI, 'Hits real upstream; skip in CI')

  // The server trusts the instance cookie only when its storage holds an
  // OAuth app for that host. The marker below is one more key under the
  // host's prefix; it never replaces a real registration. Set STORAGE_DIR to
  // the server's when the server does not run from this directory's `.data`.
  const MARKER = resolve(process.env.STORAGE_DIR ?? '.data', 'apps/fosstodon.org/e2e-thread-spec')

  test.beforeAll(() => {
    mkdirSync(dirname(MARKER), { recursive: true })
    writeFileSync(MARKER, JSON.stringify({
      client_id: 'dummy', client_secret: 'dummy', vapid_key: 'dummy', registered_at: Date.now(),
    }))
  })

  test.afterAll(() => {
    rmSync(MARKER, { force: true })
  })

  async function withInstanceCookie(context: BrowserContext) {
    await context.addCookies([{
      name: 'caribou.instance', value: 'fosstodon.org', domain: 'localhost', path: '/',
      httpOnly: true, secure: false, sameSite: 'Lax',
    }])
  }

  // A post by the instance admin that has replies: the profile's `replies`
  // tab lists statuses that sit inside a thread.
  async function threadPath(page: Page): Promise<string> {
    await page.goto('/@kev@fosstodon.org?tab=replies')
    const href = await page.locator('caribou-profile caribou-status-card a.permalink').first().getAttribute('href')
    expect(href).toMatch(/^\/@[^/]+\/\d+$/)
    return href!
  }

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    test('renders the focused post and its ancestors from the server', async ({ page, context }) => {
      await withInstanceCookie(context)
      await page.goto(await threadPath(page))
      await expect(page.locator('caribou-thread caribou-status-card[variant="focused"]')).toHaveCount(1)
      await expect(page.locator('caribou-thread caribou-status-card[variant="focused"] .status-content')).toBeVisible()
      // A reply has at least one status above it.
      expect(await page.locator('caribou-thread caribou-status-card[variant="ancestor"]').count()).toBeGreaterThan(0)
      await expect(page.getByText('Loading…')).toHaveCount(0)
      // Ancestors come first, then the focused post, then descendants.
      const variants = await page.locator('caribou-thread caribou-status-card').evaluateAll(
        (cards) => cards.map((c) => c.getAttribute('variant')),
      )
      const rank = { ancestor: 0, focused: 1, descendant: 2 } as Record<string, number>
      expect(variants.map((v) => rank[v!])).toEqual([...variants.map((v) => rank[v!])].sort((a, b) => a! - b!))
    })
  })

  test('hydrates without an error and keeps the server-rendered cards', async ({ page, context }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
    })
    await withInstanceCookie(context)
    const path = await threadPath(page)
    await watchServerPage(page, 'article[data-variant]')
    await page.goto(path)
    // Before the swap the outlet can hold two pages; read the one on screen.
    const before = await livePage(page).locator('caribou-thread caribou-status-card').evaluateAll(
      (cards) => cards.map((c) => `${c.getAttribute('variant')}:${c.getAttribute('data-id')}`),
    )
    await settled(page)
    // Every card the server sent was hydrated in place: the <article> in each
    // card's shadow root is the same node, there is no second copy, and no
    // element is left waiting for its parent.
    const report = await serverPageReport(page)
    expect(report).toEqual({ sent: before.length, atSwap: before.length, sameNodes: true, deferred: [] })
    const after = await page.locator('caribou-thread caribou-status-card').evaluateAll(
      (cards) => cards.map((c) => `${c.getAttribute('variant')}:${c.getAttribute('data-id')}`),
    )
    expect(after).toEqual(before)
    expect(after.filter((v) => v.startsWith('focused:'))).toHaveLength(1)
    await expect(page.locator('caribou-thread caribou-status-card[variant="focused"] .status-content')).toBeVisible()
    await expect(page.getByText('Loading…')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
