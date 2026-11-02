import { expect, test } from './_fixtures.js'
import { API, BOB, CAROL, card, collectErrors, homeWith, json, match, relationship, signIn, status } from './_moderation.js'

// The post menu and a filter warning on a phone (iPhone 15: touch).

test('a filter warning opens with a tap', async ({ page }) => {
  await signIn(page)
  await homeWith(page, [status('1', CAROL, [match('Spoilers', 'warn', ['home'])])])
  await expect(card(page, '1').getByText('Hidden by filter: Spoilers')).toBeVisible()
  await card(page, '1').getByRole('button', { name: 'Show' }).tap()
  await expect(card(page, '1')).toContainText('post 1')
})

test('the post menu opens inside the viewport, next to its button, and mutes', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await page.route(`${API}/v1/accounts/b1/mute`, (route) => route.fulfill(json(relationship('b1', { muting: true }))))
  await homeWith(page, [status('1', BOB), status('2', CAROL)])
  const trigger = card(page, '1').getByRole('button', { name: 'More actions' })
  await trigger.tap()
  const item = card(page, '1').getByRole('button', { name: 'Mute @bob' })
  await expect(item).toBeVisible()
  const viewport = page.viewportSize()!
  const box = (await item.boundingBox())!
  const at = (await trigger.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(Math.abs(box.y - (at.y + at.height))).toBeLessThan(80)
  await item.tap()
  await expect(card(page, '1')).toContainText('You muted @bob.')
  expect(errors).toEqual([])
})
