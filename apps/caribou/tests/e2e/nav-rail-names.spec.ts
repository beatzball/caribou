import { expect, test } from '@playwright/test'

// Below desktop the rail shows icons only, and the icons are aria-hidden, so
// each control's name comes from its clipped label. A label hidden with
// display: none would leave every control in the rail without a name.
for (const { width, layout } of [
  { width: 1280, layout: 'desktop' },
  { width: 900, layout: 'medium' },
  { width: 500, layout: 'mobile' },
]) {
  test(`every nav rail control has a name at ${layout} width`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/local')
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    const rail = page.locator('page-local caribou-nav-rail')
    // Show the signed-in controls without a session: the rail toggles these
    // attributes only when the session signal changes.
    await rail.evaluate((el) => {
      el.removeAttribute('signed-out')
      el.setAttribute('can-compose', '')
    })

    // The aria snapshot, not getByRole: every item the phone moves into
    // More is in the DOM twice, and getByRole also finds the copy slotted
    // into the closed menu, which is not in the accessibility tree.
    const tree = await rail.ariaSnapshot()
    const inBar = layout === 'mobile'
      ? ['Home', 'Local', 'Profile']
      : ['Home', 'Local', 'Public', 'Bookmarks', 'Profile']
    for (const name of inBar) expect(tree).toContain(`link "${name}"`)
    expect(tree).toContain('button "New post"')
    if (layout !== 'mobile') {
      expect(tree).toContain('button "Sign out"')
      return
    }
    await rail.getByRole('button', { name: 'More', exact: true }).click()
    for (const name of ['Public', 'Bookmarks']) {
      await expect(rail.getByRole('link', { name, exact: true })).toBeVisible()
    }
    await expect(rail.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  })
}
