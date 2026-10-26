import { expect, test, type Page } from '@playwright/test'

// A deploy replaces every hashed chunk. A browser must never keep an entry
// that points at the old ones, and a tab that is open across the deploy must
// recover on its next navigation instead of ignoring the tap.

const PUBLIC_CHUNK = /\/_litro\/assets\/public-[\w-]+\.js$/

async function settled(page: Page) {
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

// Document requests for `path`, i.e. full page loads, not SPA navigations.
function countLoads(page: Page, path: string): () => number {
  let n = 0
  page.on('request', (req) => {
    if (req.resourceType() === 'document' && new URL(req.url()).pathname === path) n++
  })
  return () => n
}

test('the page loads a versioned entry, and only hashed assets are immutable', async ({ request }) => {
  const html = await (await request.get('/about')).text()
  const src = /<script type="module" src="([^"]*\/_litro\/app\.js[^"]*)"/.exec(html)?.[1]
  expect(src).toMatch(/^\/_litro\/app\.js\?v=[0-9a-f]{12}$/)

  for (const url of [src!, '/_litro/app.js']) {
    const res = await request.get(url)
    expect(res.status()).toBe(200)
    expect(res.headers()['cache-control']).toBe('no-cache')
    expect(res.headers()['etag']).toBeTruthy()
  }

  // The entry no longer holds code other chunks import, so a chunk never
  // asks for app.js under a second URL.
  const entry = await (await request.get(src!)).text()
  const chunk = /\.\/assets\/app-main-[\w-]+\.js/.exec(entry)?.[0]
  expect(chunk).toBeTruthy()
  const res = await request.get(`/_litro/${chunk!.slice(2)}`)
  expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
  expect(await res.text()).not.toMatch(/["'`]\.\.\/app\.js["'`]/)
})

// Rewrites every chunk name a file mentions, `x-<hash>.js` → `x-<hash>.old.js`.
const toOld = (js: string) => js.replace(/((?:\.\/|assets\/)[\w@-]+)\.js\b/g, '$1.old.js')

test('a tab from an older build turns the tap into a full load of the target', async ({ page }) => {
  // Play the tab that loaded before a deploy. Its HTML names an older entry,
  // and every chunk of that older build has a name of its own (`.old.js`),
  // as after a real deploy, so the full load that follows cannot reuse any of
  // them. The server no longer has the old Public page chunk.
  await page.route('**/local', async (route) => {
    const res = await route.fetch()
    const body = (await res.text()).replace(/\/_litro\/app\.js\?v=[0-9a-f]+/, '/_litro/app.js?v=old')
    await route.fulfill({ response: res, body })
  })
  await page.route('**/_litro/app.js?v=old', async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, body: toOld(await res.text()) })
  })
  await page.route(/\.old\.js$/, async (route) => {
    const url = route.request().url()
    if (/\/public-[\w-]+\.old\.js$/.test(url)) return route.fulfill({ status: 404, body: 'not found' })
    const res = await route.fetch({ url: url.replace(/\.old\.js$/, '.js') })
    await route.fulfill({ response: res, body: toOld(await res.text()) })
  })
  await page.goto('/local')
  await settled(page)
  const loads = countLoads(page, '/public')

  await page.locator('page-local caribou-nav-rail').getByRole('link', { name: 'Public', exact: true }).click()
  await expect(page).toHaveURL(/\/public$/)
  await expect(page.locator('litro-outlet > page-public')).toHaveCount(1)
  await settled(page)
  expect(loads()).toBe(1)
})

test('a chunk that stays missing loads the page once and does not loop', async ({ page }) => {
  await page.goto('/local')
  await settled(page)
  const loads = countLoads(page, '/public')
  await page.route(PUBLIC_CHUNK, (route) => route.fulfill({ status: 404, body: 'not found' }))

  await page.locator('page-local caribou-nav-rail').getByRole('link', { name: 'Public', exact: true }).click()
  await expect(page).toHaveURL(/\/public$/)
  // The server-rendered page is still there to read.
  await expect(page.locator('litro-outlet > page-public')).toHaveCount(1)
  await page.waitForTimeout(1500)
  expect(loads()).toBe(1)
})
