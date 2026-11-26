import { COMPLETE_PAGE_CSP, completeSigninPage } from '../../server/lib/signin-complete-page.js'
import { expect, test, type Page } from './_fixtures.js'
import {
  INSTANCE, expectNavItemsFit, expectNoSidewaysScroll, gotoSettled, openPage, signIn, storeTextSize,
} from './_text-size.js'

// The text size setting (issue 309): five steps, per device, applied before
// the first paint. The phone layout at the largest step is in
// text-size.mobile.spec.ts.

interface FirstPaint { size: string | null; font: string }

// Records, before any of the app's code runs, `data-text-size` on <html>
// when the parser first reaches <body>, and the root font size on the first
// frame that has a body. Both must already be the stored step: then no
// frame was painted at another size. (The same idea as `watchFirstPaint` in
// settings.spec.ts.)
async function watchFirstPaint(page: Page) {
  await page.addInitScript(() => {
    const seen: FirstPaint = { size: 'unset', font: '' }
    ;(window as unknown as { __firstPaint?: FirstPaint }).__firstPaint = seen
    new MutationObserver((_, obs) => {
      if (!document.body) return
      seen.size = document.documentElement.getAttribute('data-text-size')
      obs.disconnect()
    }).observe(document, { childList: true, subtree: true })
    const frame = () => {
      if (!document.body) { requestAnimationFrame(frame); return }
      seen.font = getComputedStyle(document.documentElement).fontSize
    }
    requestAnimationFrame(frame)
  })
}

// `goto` can return before the first frame; wait for the frame to record it.
async function firstPaint(page: Page): Promise<FirstPaint> {
  const handle = await page.waitForFunction(() => {
    const seen = (window as unknown as { __firstPaint?: FirstPaint }).__firstPaint
    return seen && seen.font !== '' ? seen : null
  })
  return handle.jsonValue() as Promise<FirstPaint>
}

const rootFont = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
const attr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-text-size'))

// The root font size of a page with no author styles: the browser's own.
async function browserDefault(page: Page): Promise<number> {
  const blank = await page.context().newPage()
  await blank.setContent('<!doctype html><title>x</title>')
  const size = await rootFont(blank)
  await blank.close()
  return size
}

test('Largest, picked with the keyboard, applies at once and paints from the first frame after a reload', async ({ page }) => {
  await signIn(page)
  await watchFirstPaint(page)
  const errors: string[] = []
  page.on('pageerror', (e) => { errors.push(e.message) })
  await openPage(page, '/settings', 'caribou-settings-appearance')
  const base = await rootFont(page)
  expect(base).toBe(await browserDefault(page))
  expect(await attr(page)).toBeNull()

  const group = page.getByRole('group', { name: 'Text size' })
  const names = await group.getByRole('radio').evaluateAll((list) =>
    list.map((r) => (r as HTMLInputElement).closest('label')!.textContent!.trim()))
  expect(names).toEqual(['Smallest', 'Smaller', 'Default', 'Larger', 'Largest'])
  await expect(group.getByRole('radio', { name: 'Default' })).toBeChecked()

  // Native radios: focus the checked one, then the arrow keys move and check.
  await group.getByRole('radio', { name: 'Default' }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(group.getByRole('radio', { name: 'Larger' })).toBeChecked()
  await expect.poll(() => attr(page)).toBe('lg')
  expect(await rootFont(page)).toBeCloseTo(base * 1.125, 1)
  await page.keyboard.press('ArrowDown')
  await expect(group.getByRole('radio', { name: 'Largest' })).toBeChecked()
  await expect.poll(() => attr(page)).toBe('xl')
  expect(await rootFont(page)).toBeCloseTo(base * 1.25, 1)
  expect(await page.evaluate(() => localStorage.getItem('caribou.textSize'))).toBe('xl')

  await page.reload()
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  const seen = await firstPaint(page)
  expect(seen.size).toBe('xl')
  expect(parseFloat(seen.font)).toBeCloseTo(base * 1.25, 1)
  await expect(page.getByRole('group', { name: 'Text size' }).getByRole('radio', { name: 'Largest' })).toBeChecked()
  expect(errors).toEqual([])
})

test('the default step leaves the root font size as the browser has it', async ({ page }) => {
  const base = await browserDefault(page)
  await gotoSettled(page, '/about')
  expect(await attr(page)).toBeNull()
  expect(await rootFont(page)).toBe(base)

  await page.evaluate(() => { localStorage.setItem('caribou.textSize', 'md') })
  await page.reload()
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  expect(await attr(page)).toBeNull()
  expect(await rootFont(page)).toBe(base)
})

test('each step scales the root by its percentage, signed out too', async ({ page }) => {
  const base = await browserDefault(page)
  for (const [size, ratio] of [['xs', 0.875], ['sm', 0.9375], ['lg', 1.125], ['xl', 1.25]] as const) {
    await page.goto('/about')
    await page.evaluate((s) => { localStorage.setItem('caribou.textSize', s) }, size)
    await page.reload()
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    expect(await attr(page)).toBe(size)
    expect(await rootFont(page)).toBeCloseTo(base * ratio, 1)
  }
})

test('another open tab follows a change', async ({ page, context }) => {
  await signIn(page)
  await openPage(page, '/settings', 'caribou-settings-appearance')
  const other = await context.newPage()
  await other.goto('/about')
  await other.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  expect(await attr(other)).toBeNull()

  await page.getByRole('group', { name: 'Text size' }).getByRole('radio', { name: 'Smaller' }).check()
  await expect.poll(() => attr(other)).toBe('sm')
  await page.getByRole('group', { name: 'Text size' }).getByRole('radio', { name: 'Default' }).check()
  await expect.poll(() => attr(other)).toBeNull()
})

test('pages outside the app shell paint the stored size too', async ({ page }) => {
  const base = await browserDefault(page)
  await storeTextSize(page, 'xl')
  await watchFirstPaint(page)

  const notFound = await page.goto('/no-such-page')
  expect(notFound?.status()).toBe(404)
  expect(await firstPaint(page)).toEqual({ size: 'xl', font: `${base * 1.25}px` })

  await page.goto('/signin/done')
  expect(await firstPaint(page)).toEqual({ size: 'xl', font: `${base * 1.25}px` })

  // The sign-in completion page, under its own strict CSP: the text size
  // script runs by its hash.
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  const origin = new URL(page.url()).origin
  await page.route(`${origin}/api/signin/callback?code=E2E-OK**`, (route) => route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': COMPLETE_PAGE_CSP },
    body: completeSigninPage({ token: '', server: INSTANCE, userKey: `alice@${INSTANCE}`, vapidKey: '' }),
  }))
  await page.goto('/api/signin/callback?code=E2E-OK&state=S')
  await expect(page.getByText('Something went wrong completing sign-in.')).toBeVisible()
  expect(await firstPaint(page)).toEqual({ size: 'xl', font: `${base * 1.25}px` })
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([])
})

test('a refused save puts the text size back and says so', async ({ page }) => {
  await signIn(page)
  await openPage(page, '/settings', 'caribou-settings-appearance')
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
  })
  const group = page.getByRole('group', { name: 'Text size' })
  await group.getByRole('radio', { name: 'Largest' }).click()
  await expect(page.getByRole('region', { name: 'Appearance' }).getByRole('status')).toHaveText(/Not saved/)
  await expect(group.getByRole('radio', { name: 'Default' })).toBeChecked()
  expect(await attr(page)).toBeNull()
})

// Desktop and tablet widths at the largest step: the rail's labels, the
// right rail and the timeline still fit.
for (const width of [768, 1024, 1280]) {
  test(`at ${width}px wide, the largest step fits`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await storeTextSize(page, 'xl')
    await signIn(page)
    for (const path of ['/home', '/settings']) {
      await openPage(page, path, path === '/home' ? 'caribou-status-card' : 'caribou-settings-appearance')
      expect(await attr(page)).toBe('xl')
      await expectNoSidewaysScroll(page, `${path} at ${width}px`)
      await expectNavItemsFit(page)
    }
  })
}
