import { expect, test } from './_fixtures.js'

// `/signin/done` once finished a sign-in from the session in its URL
// fragment, so any link could sign a reader in to someone else's account.
// Now the callback's own response finishes a sign-in, and this page only
// offers the way back, whatever its URL holds.

for (const [name, path] of [
  ['no fragment', '/signin/done'],
  ['a full session in the fragment', '/signin/done#token=TOK&server=example.social&userKey=alice%40example.social&vapidKey=VK'],
  ['a malformed fragment', '/signin/done#token=TOK&server=example.social&userKey=bogus&vapidKey=VK'],
] as const) {
  test(`signin-done with ${name} shows the fallback and stores nothing`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByText(/something went wrong/i)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Return to start' })).toHaveAttribute('href', '/')
    const ls = await page.evaluate(() => ({
      users: localStorage.getItem('caribou.users'),
      active: localStorage.getItem('caribou.activeUserKey'),
    }))
    expect(ls).toEqual({ users: null, active: null })
    expect(new URL(page.url()).pathname).toBe('/signin/done')
  })
}
