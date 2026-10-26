import { createHash } from 'node:crypto'
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

  // The version is the entry's own content hash, so it moves with every build.
  const entry = await (await request.get('/_litro/app.js')).body()
  expect(src).toBe(`/_litro/app.js?v=${createHash('sha256').update(entry).digest('hex').slice(0, 12)}`)

  // During a rolling deploy the HTML of the other build can ask this one for
  // its entry. The page gets a working file, but no browser may keep it under
  // that URL.
  const foreign = await request.get('/_litro/app.js?v=000000000000')
  expect(foreign.status()).toBe(200)
  expect(foreign.headers()['cache-control']).toBe('no-store')
  expect(await foreign.body()).toEqual(entry)
  // A revalidation of that URL is a 304 from Nitro's static handler, and it
  // must say `no-store` too, or the browser keeps whatever it had there.
  const revalidated = await request.get('/_litro/app.js?v=000000000000', {
    headers: { 'if-none-match': foreign.headers()['etag']! },
  })
  expect(revalidated.status()).toBe(304)
  expect(revalidated.headers()['cache-control']).toBe('no-store')

  // The entry holds no code other chunks import, so no chunk asks for it
  // under a second URL. Walk every chunk the entry can reach.
  const seen = new Set<string>()
  const queue = [...chunkNames(entry.toString())]
  while (queue.length > 0) {
    const name = queue.pop()!
    if (seen.has(name)) continue
    seen.add(name)
    const res = await request.get(`/_litro/assets/${name}`)
    expect(res.status(), name).toBe(200)
    expect(res.headers()['cache-control'], name).toBe('public, max-age=31536000, immutable')
    const js = await res.text()
    // A static or dynamic import of the entry, or the entry in a preload list.
    expect(js, name).not.toMatch(/(?:from|import\s*\(?)\s*["'`][^"'`]*\/app\.js[?"'`]|["'`]app\.js["'`]/)
    queue.push(...chunkNames(js))
  }
  // app-main, boot and every page chunk at least.
  expect(seen.size).toBeGreaterThan(10)
})

// Hashed chunk names a file mentions (`x-<8-char hash>.js`): `./x.js` and
// `./assets/x.js` imports, and `assets/x.js` in Vite's preload lists.
function chunkNames(js: string): string[] {
  return [...js.matchAll(/(?:\.\/|assets\/)(?:assets\/)?([\w@-]+-[\w-]{8}\.js)\b/g)].map((m) => m[1]!)
}

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
