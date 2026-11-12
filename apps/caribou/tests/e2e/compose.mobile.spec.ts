import { expect, test, type Page } from './_fixtures.js'
import { API, BOB, gotoSettled, json, signIn, status } from './_moderation.js'

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
  await card.getByRole('button', { name: 'Reply', exact: true }).tap()
  const dialog = page.getByRole('dialog', { name: 'Reply', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

for (const close of ['Cancel', 'Escape'] as const) {
  test(`rule 3: Reply locks the page against scroll attempts and touch; ${close} restores its position`, async ({ page }) => {
    // Capture the position immediately before the reply opens (tap may scroll
    // the button into view), and a card's screen position to detect page motion.
    await page.addInitScript(() => {
      window.addEventListener('caribou:compose', () => {
        document.body.dataset.beforeComposeY = String(window.scrollY)
      }, { capture: true })
    })
    const dialog = await replyFromTimeline(page)
    const before = Number(await page.locator('body').getAttribute('data-before-compose-y'))
    expect(before).toBeGreaterThan(0)
    await expect(page.locator('body')).toHaveCSS('position', 'fixed')
    await expect(page.locator('body')).toHaveCSS('top', `${-before}px`)
    const card = page.locator('caribou-status-card[data-status-id="6"]')
    const top = (await card.boundingBox())!.y
    // Mobile WebKit has no native wheel or swipe automation. Exercise the
    // gesture listeners, then attempt scrolling the page directly. The
    // desktop compose spec also exercises a native wheel input.
    await dialog.evaluate((el) => {
      for (const [type, y] of [['touchstart', 250], ['touchmove', 80], ['touchend', 80]] as const) {
        const touch = { identifier: 1, target: el, clientX: 10, clientY: y }
        el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
          touches: type === 'touchend' ? [] : [touch], changedTouches: [touch],
        }))
      }
      window.scrollBy(0, 600)
    })
    // Give any asynchronous scrolling time to settle before measuring.
    await page.waitForTimeout(200)
    expect((await card.boundingBox())!.y).toBeCloseTo(top, 0)
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
