import { expect, test } from './_fixtures.js'
import { card, collectErrors, signIn } from './_moderation.js'
import { fakeServer, gotoSettled, own } from './_own-posts.js'

// Edit and the edit history on a phone (iPhone 15: touch).

test('the own-post menu opens in the viewport; Edit and the history dialog fit the screen', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await fakeServer(page, [own('1', 'teh typo', { edited_at: '2026-11-01T10:00:00.000Z' })])
  await gotoSettled(page, '/home')
  const viewport = page.viewportSize()!
  const inside = async (box: { x: number; y: number; width: number; height: number } | null) => {
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  }

  await card(page, '1').getByRole('button', { name: /^More actions/ }).tap()
  const edit = card(page, '1').getByRole('button', { name: 'Edit', exact: true })
  await expect(edit).toBeVisible()
  await inside(await edit.boundingBox())
  await edit.tap()
  const dialog = page.locator('caribou-compose-dialog dialog')
  await expect(dialog.getByRole('heading', { name: 'Edit post' })).toBeVisible()
  await inside(await dialog.boundingBox())
  await dialog.getByRole('textbox', { name: 'Post text' }).fill('the typo')
  await dialog.getByRole('button', { name: 'Save' }).tap()
  await expect(dialog).toBeHidden()
  await expect(card(page, '1')).toContainText('the typo')

  const mark = card(page, '1').getByRole('button', { name: /Show edit history/ })
  const markBox = (await mark.boundingBox())!
  expect(markBox.height).toBeGreaterThanOrEqual(44)
  await mark.tap()
  const history = page.getByRole('dialog', { name: 'Edit history' })
  await expect(history.getByRole('listitem')).toHaveCount(2)
  await inside(await history.boundingBox())
  await history.getByRole('button', { name: 'Close' }).tap()
  await expect(history).toBeHidden()
  expect(errors).toEqual([])
})
