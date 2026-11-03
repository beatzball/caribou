import { expect, isGroupedProbe404, test, type Page } from './_fixtures.js'
import { BOB, CAROL, INSTANCE, openNotifications, post, serveGrouped } from './_grouped-notifications.js'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !isGroupedProbe404(m.text(), m.location().url)) errors.push(`console: ${m.text()}`)
  })
  return errors
}

test('a Mastodon 4.3+ server: favourites on one post and follows show as one row each', async ({ page }) => {
  const asked = await serveGrouped(page)
  const errors = collectErrors(page)
  const list = await openNotifications(page)
  const rows = list.locator('ul.rows > li')
  await expect(rows).toHaveCount(3)

  const fav = rows.nth(0)
  await expect(fav.locator('.line')).toContainText('Alice Example, Bob Example and 12 others favourited your post')
  await expect(fav.locator('.avatars img')).toHaveCount(2)
  await expect(fav.getByText('my busy post')).toBeVisible()
  await expect(rows.nth(1)).toHaveClass(/n-mention/)
  await expect(rows.nth(2).locator('.line')).toContainText('Carol Example and Alice Example followed you')
  expect(new URLSearchParams(asked[0]).getAll('grouped_types[]')).toEqual(['favourite', 'reblog', 'follow'])

  // Show all loads everyone, from the keyboard too.
  const toggle = fav.getByRole('button', { name: 'Show all 14 who favourited your post' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.focus()
  await page.keyboard.press('Enter')
  const who = fav.getByRole('list', { name: 'Who' })
  await expect(who.getByRole('link')).toHaveCount(14)
  await expect(who.getByRole('link').nth(2)).toHaveText('Carol Example')
  await expect(who).not.toContainText('more')
  await expect(who.getByRole('link', { name: 'Bob Example' })).toHaveAttribute('href', `/@bob@${INSTANCE}`)
  const hide = fav.getByRole('button', { name: 'Hide who favourited your post' })
  await expect(hide).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(who).toHaveCount(0)

  const prefs = await page.evaluate((key) => localStorage.getItem(`caribou.prefs.${key}`), `reader@${INSTANCE}`)
  expect(JSON.parse(prefs!)).toMatchObject({ lastSeenNotificationId: '30' })
  expect(errors).toEqual([])
})

test('an older server: the list groups single notifications itself', async ({ page }) => {
  const single = (id: string, type: string, account: unknown, status?: unknown) => ({
    id, type, created_at: '2026-11-01T10:00:00.000Z', account, ...(status ? { status } : {}),
  })
  const busy = post('s1', '<p>my busy post</p>')
  const v2: string[] = []
  await page.route('**/api/v2/notifications*', (route) => {
    v2.push(route.request().url())
    return route.fallback()
  })
  await page.route('**/api/v1/notifications*', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('max_id') || u.searchParams.get('min_id') || u.searchParams.get('limit')) {
      return route.fulfill({ json: [] })
    }
    return route.fulfill({ json: [
      single('5', 'reblog', CAROL, busy),
      single('4', 'mention', BOB, post('s2', '<p>hi @reader</p>')),
      single('3', 'reblog', BOB, busy),
      single('2', 'follow', CAROL),
    ] })
  })
  const errors = collectErrors(page)
  const list = await openNotifications(page)
  const rows = list.locator('ul.rows > li')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0).locator('.line')).toContainText('Carol Example and Bob Example boosted your post')
  await expect(rows.nth(2).locator('.line')).toContainText('Carol Example followed you')
  await rows.nth(0).getByRole('button', { name: 'Show all' }).click()
  await expect(rows.nth(0).getByRole('list', { name: 'Who' }).getByRole('link'))
    .toHaveText(['Carol Example', 'Bob Example'])
  expect(v2).toHaveLength(1)
  expect(errors).toEqual([])
})
