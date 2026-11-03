import { expect, test } from './_fixtures.js'
import { API, BOB, card, collectErrors, gotoSettled, json, relationship, signIn, status } from './_moderation.js'
import { list, openBob, serveLists } from './_lists.js'

// Lists on a phone (iPhone 15: touch, the bottom nav bar).

const noSideScroll = () => document.documentElement.scrollWidth <= window.innerWidth

test('Lists is in the More menu, and a list reads with its header in the viewport', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await serveLists(page, [list('3', 'A list with a rather long title for a phone')])
  await page.route(`${API}/v1/timelines/list/3*`, (route) => {
    const q = new URL(route.request().url()).searchParams
    return route.fulfill(json(q.has('max_id') || q.has('since_id') ? [] : [status('1', BOB)]))
  })
  await page.route(`${API}/v1/timelines/home*`, (route) => route.fulfill(json([])))
  await gotoSettled(page, '/home')
  await page.getByRole('button', { name: 'More', exact: true }).tap()
  await page.getByRole('link', { name: 'Lists' }).tap()
  await expect(page.getByRole('heading', { level: 1, name: 'Lists' })).toBeVisible()
  expect(await page.evaluate(noSideScroll)).toBe(true)

  await page.getByRole('link', { name: 'A list with a rather long title for a phone' }).tap()
  await expect(page.getByRole('heading', { level: 1, name: 'A list with a rather long title for a phone' })).toBeVisible()
  await expect(card(page, '1')).toContainText('post 1')
  const viewport = page.viewportSize()!
  for (const name of ['Edit list', 'Members']) {
    const box = (await page.getByRole('button', { name }).boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(noSideScroll)).toBe(true)
  expect(errors).toEqual([])
})

test('the list picker fits the phone and takes a tap', async ({ page }) => {
  await signIn(page)
  await page.route(`${API}/v1/accounts/relationships*`, (route) => route.fulfill(json([relationship('b1', { following: true })])))
  const server = await serveLists(page, [list('1', 'Friends')], { 1: [] })
  await page.route(`${API}/v1/accounts/b1/lists`, (route) => route.fulfill(json([])))
  await openBob(page)
  const header = page.locator('caribou-profile-header')
  await header.getByRole('button', { name: 'More actions for @bob' }).tap()
  await header.getByRole('button', { name: 'Add to lists' }).tap()
  const picker = page.getByRole('dialog', { name: 'Lists for @bob' })
  const box = (await picker.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  await picker.getByText('Friends').tap()
  await expect(picker.getByRole('checkbox', { name: 'Friends' })).toBeChecked()
  await expect.poll(() => server.writes).toEqual(['add b1 1'])
})
