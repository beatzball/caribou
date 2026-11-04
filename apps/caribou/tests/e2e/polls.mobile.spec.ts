import { expect, test } from './_fixtures.js'
import { collectErrors, signIn } from './_moderation.js'
import { gotoSettled, poll, pollIn, pollPost, pollServer } from './_polls.js'

// Polls on a phone (iPhone 15: touch): choices big enough to tap, nothing
// wider than the screen, and the compose builder inside the viewport.

const LONG = 'An option with a very long title that has to wrap on a narrow screen instead of pushing the card wider'

test('a poll fits the screen, its choices are tap-sized, and a tap votes', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  const p1 = poll('p1', { options: [{ title: LONG, votes_count: 1 }, { title: 'Short', votes_count: 0 }] })
  const s = await pollServer(page, [pollPost('1', p1)], [p1])
  await gotoSettled(page, '/home')
  const p = pollIn(page, '1')
  const viewport = page.viewportSize()!
  const box = (await p.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  for (const label of await p.locator('li.choice label').all()) {
    expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await p.getByText('Short').tap()
  await p.getByRole('button', { name: 'Vote' }).tap()
  await expect(p).toContainText('You voted')
  expect(s.votes).toEqual([{ id: 'p1', choices: [1] }])
  const after = (await p.boundingBox())!
  expect(after.x + after.width).toBeLessThanOrEqual(viewport.width)
  expect(errors).toEqual([])
})

test('the compose poll builder fits the screen', async ({ page }) => {
  await signIn(page)
  await pollServer(page, [], [])
  await gotoSettled(page, '/home')
  await page.getByRole('button', { name: 'New post' }).first().tap()
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await dialog.getByRole('button', { name: 'Poll' }).tap()
  const group = dialog.getByRole('group', { name: 'Poll' })
  await group.getByRole('button', { name: 'Add option' }).tap()
  await expect(group.getByRole('textbox')).toHaveCount(3)
  const viewport = page.viewportSize()!
  const box = (await group.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  const remove = group.getByRole('button', { name: 'Remove option 3' })
  expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await remove.tap()
  await expect(group.getByRole('textbox')).toHaveCount(2)
})
