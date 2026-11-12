import { expect, test, type Page } from './_fixtures.js'
import { checkComposeHistory } from './_compose-scroll.js'
import { expectComposeAlert, LONG_COMPOSE_ERROR } from './_compose-a11y.js'
import { API, ALICE, BOB, gotoSettled, json, signIn, status } from './_moderation.js'

async function replyFromTimeline(page: Page) {
  await signIn(page)
  await page.route(`${API}/v1/timelines/home*`, (route) => {
    const query = new URL(route.request().url()).searchParams
    return route.fulfill(json(query.has('max_id') || query.has('since_id')
      ? [] : Array.from({ length: 20 }, (_, i) => status(String(i + 1), BOB))))
  })
  await page.route(`${API}/v2/instance`, (route) => route.fulfill(json({
    configuration: { statuses: { max_characters: 500, max_media_attachments: 4 } },
  })))
  await gotoSettled(page, '/home')
  const card = page.locator('caribou-status-card[data-status-id="6"]')
  await card.scrollIntoViewIfNeeded()
  await page.evaluate(() => {
    let active = document.activeElement
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  await card.getByRole('button', { name: 'Reply', exact: true }).tap()
  const dialog = page.getByRole('dialog', { name: 'Reply', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

for (const close of ['Cancel', 'Escape'] as const) {
  test(`rule 3: Reply keeps the document reading position; ${close} restores its position`, async ({ page }) => {
    // Capture the position immediately before the reply opens: tapping may
    // first scroll the button into view.
    await page.addInitScript(() => {
      window.addEventListener('caribou:compose', () => {
        document.body.dataset.beforeComposeY = String(window.scrollY)
      }, { capture: true })
    })
    const dialog = await replyFromTimeline(page)
    const before = Number(await page.locator('body').getAttribute('data-before-compose-y'))
    expect(before).toBeGreaterThan(0)
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden')
    await expect(page.locator('html')).toHaveCSS('overscroll-behavior', 'none')
    await expect(page.locator('body')).not.toHaveCSS('position', 'fixed')
    // This checks document position, not native swipe scrolling. Chromium
    // CDP coverage in compose.spec.ts sends real touch input separately.
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
    if (close === 'Cancel') await dialog.getByRole('button', { name: 'Cancel' }).tap()
    else await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before)
    await expect(page.locator('body')).not.toHaveCSS('position', 'fixed')
    // The page can scroll again after closing.
    await page.evaluate(() => window.scrollBy(0, 100))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
  })
}

test('rules 1 and 2: Reply and Cancel stay inside a shrinking and panning visual viewport', async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  })
  const dialog = await replyFromTimeline(page)
  await dialog.getByRole('textbox', { name: 'Post text' }).fill('A long reply\n'.repeat(30))
  // The keyboard reduces the visual viewport without changing dvh on iOS.
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 300, offsetTop: 70 })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  await expect.poll(async () => (await dialog.boundingBox())!.height).toBeCloseTo(300, 0)
  await expect.poll(async () => (await dialog.boundingBox())!.y).toBeCloseTo(70, 0)
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { offsetTop: 90 })
    window.visualViewport!.dispatchEvent(new Event('scroll'))
  })
  await expect.poll(async () => (await dialog.boundingBox())!.y).toBeCloseTo(90, 0)
  for (const name of ['Reply', 'Cancel']) {
    const button = dialog.getByRole('button', { name, exact: true })
    const box = (await button.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(90)
    expect(box.y + box.height).toBeLessThanOrEqual(390)
  }
  const body = dialog.locator('.sheet-body')
  await expect(body).toHaveCSS('overscroll-behavior', 'contain')
  await body.evaluate((el) => { el.scrollTop = el.scrollHeight })
  const post = (await dialog.getByRole('button', { name: 'Reply', exact: true }).boundingBox())!
  expect(post.y + post.height).toBeLessThanOrEqual(390)
})

test('compose rule 3: Back then Forward restores the phone reading position with the real router', async ({ page }) => {
  await checkComposeHistory(page)
})


for (const close of ['Cancel', 'Escape', 'successful send'] as const) {
  test(`compose rule 6: tapping Reply returns focus to its invoker after ${close}`, async ({ page }) => {
    await page.route(`${API}/v1/statuses`, (route) => route.fulfill(json(status('posted', ALICE))))
    const dialog = await replyFromTimeline(page)
    const invoker = page.locator('caribou-status-card[data-status-id="6"]').getByRole('button', { name: 'Reply', exact: true })
    if (close === 'Cancel') await dialog.getByRole('button', { name: 'Cancel' }).tap()
    else if (close === 'Escape') await page.keyboard.press('Escape')
    else {
      await dialog.getByRole('textbox', { name: 'Post text' }).fill('a reply')
      await dialog.getByRole('button', { name: 'Reply', exact: true }).tap()
    }
    await expect(dialog).toBeHidden()
    await expect(invoker).toBeFocused()
  })
}


for (const rejection of [
  'Fixture rejection: try again',
  LONG_COMPOSE_ERROR,
]) {
  test(`compose rule 5: a ${rejection.length}-character rejection leaves the editor and actions above the phone keyboard`, async ({ page }) => {
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), { height: 300, offsetTop: 90 })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    })
    let reject = true
    await page.route(`${API}/v1/statuses`, (route) => reject
      ? route.fulfill({ status: 422, json: { error: rejection } })
      : route.fulfill(json(status('posted', ALICE))))
    const dialog = await replyFromTimeline(page)
    const text = dialog.getByRole('textbox', { name: 'Post text' })
    await text.fill('keep this reply')
    await dialog.getByRole('button', { name: 'Reply', exact: true }).tap()
    await expectComposeAlert(page, dialog, `Could not post: ${rejection.trim()}`)
    await expect(text).toHaveValue('keep this reply')
    const body = dialog.locator('.sheet-body')
    expect(await body.evaluate((el) => el.clientHeight)).toBeGreaterThan(0)
    const alert = dialog.getByRole('alert')
    if (rejection.length > 100) {
      const area = await alert.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
      expect(area.client).toBeGreaterThan(0)
      expect(area.scroll).toBeGreaterThan(area.client)
      await alert.focus()
      await page.keyboard.press('End')
      await expect.poll(() => alert.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      await expect(alert).toContainText('This post could not be accepted by the server.')
    }
    for (const control of [alert,
      dialog.getByRole('button', { name: 'Reply', exact: true }),
      dialog.getByRole('button', { name: 'Cancel', exact: true })]) {
      const bounds = (await control.boundingBox())!
      expect(bounds.y).toBeGreaterThanOrEqual(90)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(390)
    }
    reject = false
    await dialog.getByRole('button', { name: 'Reply', exact: true }).tap()
    await expect(dialog).toBeHidden()
  })
}
