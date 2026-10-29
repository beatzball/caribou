import { expect, test, type Page } from '@playwright/test'

async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

test('the tab says Caribou on load and after client-side navigation', async ({ page }) => {
  await gotoSettled(page, '/about')
  await expect(page).toHaveTitle('Caribou')

  // A marker on window survives a client-side navigation, not a page load.
  await page.evaluate(() => { (window as unknown as { __spa: boolean }).__spa = true })
  await page.getByRole('link', { name: 'Privacy' }).click()
  await page.waitForURL('**/privacy')
  expect(await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa)).toBe(true)
  await expect(page).toHaveTitle('Caribou')
})

test('the head links the icons, the manifest and an absolute og:image', async ({ page }) => {
  await gotoSettled(page, '/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site.webmanifest')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https?:\/\/.+\/og-image\.png$/)
})

test('the landing page shows the logo', async ({ page }) => {
  await gotoSettled(page, '/')
  const logo = page.getByRole('heading', { level: 1 }).locator('img')
  await expect(logo).toHaveAttribute('alt', '')
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
})

test('/favicon.ico is served as an icon', async ({ request }) => {
  const res = await request.get('/favicon.ico')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toMatch(/^image\/(vnd\.microsoft\.icon|x-icon)/)
})

test('/site.webmanifest is served, and so is every icon it lists', async ({ request }) => {
  const res = await request.get('/site.webmanifest')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('application/manifest+json')
  const manifest = (await res.json()) as { name: string; icons: { src: string }[] }
  expect(manifest.name).toBe('Caribou')
  for (const icon of manifest.icons) {
    const iconRes = await request.get(icon.src)
    expect(iconRes.status(), icon.src).toBe(200)
    expect(iconRes.headers()['content-type'], icon.src).toBe('image/png')
  }
})
