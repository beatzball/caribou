import { expect, test } from './_fixtures.js'
import { API, BOB, card, collectErrors, homeWith, json, relationship, signIn, status } from './_moderation.js'
import { STATE_POSTS, accepted, quoted } from './_quotes.js'

// Quote posts (#56): the quoted post shows inside the quoting one, or a
// short note for a quote that shows no post.

const quoteIn = (page: Parameters<typeof card>[0], id: string) => card(page, id).locator('caribou-status-quote')

test('a quote shows the quoted post; each other state shows its note', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await homeWith(page, [accepted('p1', quoted('q1')), ...STATE_POSTS])
  const q = quoteIn(page, 'p1')
  await expect(q.locator('.author')).toContainText('BOB')
  await expect(q.locator('.quote-content')).toHaveText('quoted words q1')
  await expect(q.locator('a.permalink')).toHaveAttribute('href', '/@bob/q1')
  const notes: Record<string, string> = {
    pending: 'has not approved', rejected: 'declined', revoked: 'removed this quote',
    deleted: 'was deleted', unauthorized: 'cannot see', muted_account: 'you muted its author',
  }
  for (const [state, words] of Object.entries(notes)) {
    await expect(quoteIn(page, `s-${state}`).locator('.quote-note')).toContainText(words)
  }
  expect(errors).toEqual([])
})

test('a quoted post with a content warning stays closed until Show more', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await homeWith(page, [accepted('p1', quoted('q1', { spoiler_text: 'Finale', sensitive: true }))])
  const q = quoteIn(page, 'p1')
  await expect(q.locator('.spoiler')).toHaveText('Finale')
  await expect(q.locator('.quote-content')).toHaveCount(0)
  await q.getByRole('button', { name: 'Show more' }).click()
  await expect(q.locator('.quote-content')).toHaveText('quoted words q1')
  expect(errors).toEqual([])
})

test('muting the quoted author hides the quoted post', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await page.route(`${API}/v1/accounts/b1/*`, (route) =>
    route.fulfill(json(relationship('b1', { muting: true }))))
  await homeWith(page, [status('b', BOB), accepted('p1', quoted('q1'))])
  await expect(quoteIn(page, 'p1').locator('.quote-content')).toHaveText('quoted words q1')
  await card(page, 'b').getByRole('button', { name: 'More actions' }).click()
  await card(page, 'b').getByRole('button', { name: 'Mute @bob' }).click()
  await expect(quoteIn(page, 'p1').locator('.quote-note')).toHaveText('Quoted post hidden: you muted @bob.')
  await expect(quoteIn(page, 'p1').locator('.quote-content')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a click on the quoted post opens its thread without a full page load', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await page.route(`${API}/v1/statuses/q1*`, (route) => route.fulfill(json(
    route.request().url().includes('/context') ? { ancestors: [], descendants: [] } : quoted('q1'))))
  await homeWith(page, [accepted('p1', quoted('q1'))])
  await page.evaluate(() => { (window as unknown as { __same: boolean }).__same = true })
  await quoteIn(page, 'p1').locator('.quote-content').click()
  await expect(page).toHaveURL(/\/@bob\/q1$/)
  await expect(page.locator('page-handle-statusid')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __same?: boolean }).__same)).toBe(true)
  expect(errors).toEqual([])
})
