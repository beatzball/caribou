import { expect, test } from './_fixtures.js'
import { card, collectErrors, homeWith, signIn } from './_moderation.js'
import { accepted, quoted } from './_quotes.js'

// On a phone the quoted post fits inside its card: no sideways scroll, even
// with a long unbroken word.
test('a quoted post fits the phone screen', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  const long = `<p>${'x'.repeat(200)}</p>`
  await homeWith(page, [accepted('p1', quoted('q1', { content: long }))])
  const q = card(page, 'p1').locator('caribou-status-quote')
  await expect(q.locator('.quote-content')).toBeVisible()
  const cardBox = (await card(page, 'p1').boundingBox())!
  const quoteBox = (await q.boundingBox())!
  expect(quoteBox.x).toBeGreaterThanOrEqual(cardBox.x)
  expect(quoteBox.x + quoteBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(errors).toEqual([])
})
