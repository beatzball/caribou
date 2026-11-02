import { expect, test } from './_fixtures.js'
import { openNotifications, serveGrouped } from './_grouped-notifications.js'

// Runs in the `mobile-webkit` project only (iPhone 15: touch, 393px wide).

test('a grouped row fits the phone, and its list of who opens and closes', async ({ page }) => {
  await serveGrouped(page)
  const list = await openNotifications(page)
  const row = list.locator('ul.rows > li').first()
  await expect(row.locator('.line')).toContainText('Alice Example, Bob Example and 12 others favourited your post')

  const toggle = row.getByRole('button', { name: 'Show all' })
  await expect(toggle).toBeInViewport()
  await toggle.tap()
  await expect(row.getByRole('list', { name: 'Who' }).getByRole('link')).toHaveText(['Alice Example', 'Bob Example'])

  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(client)
  await row.getByRole('button', { name: 'Hide' }).tap()
  await expect(row.getByRole('list', { name: 'Who' })).toHaveCount(0)
})
