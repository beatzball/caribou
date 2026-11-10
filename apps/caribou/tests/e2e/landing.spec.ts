import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// A full page load mounts the page twice; the router swaps the two and then
// marks the outlet. Before that, fill() and click() can land on different
// mounts, so every test that interacts waits for it.
async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
}

test('landing page renders picker', async ({ page }) => {
  await gotoSettled(page, '/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Caribou')
  await expect(page.getByLabel(/your mastodon instance/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

// Bluesky is on for everyone (#169): a first visit, with nothing in
// storage, gets the Bluesky sign-in. The server HTML already has the panels,
// so the first client render matches it.
test('a first-time visitor sees the Bluesky sign-in', async ({ page, request }) => {
  const html = await (await request.get('/')).text()
  expect(html).toContain('<caribou-signin-panels')
  expect(html).not.toContain('A Mastodon client. Enter your instance')
  await gotoSettled(page, '/')
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
  await expect(page.getByText('A Mastodon and Bluesky client. Pick a network to sign in.')).toBeVisible()
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await expect(page.getByLabel('Bluesky handle')).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' })).toBeVisible()
})

// The router keeps the server's page live while it renders the client page
// hidden, then swaps (#169). Hold the swap: a reader who picks Bluesky and
// types a handle in that window keeps both, and the focus, after it.
test('a tab and a handle chosen before the router swap are kept', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __held: FrameRequestCallback[]; __hold: boolean; __release(): void }
    w.__held = []
    w.__hold = true
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      if (!w.__hold) return raf(cb)
      w.__held.push(cb)
      return 0
    }
    w.__release = () => {
      w.__hold = false
      for (const cb of w.__held.splice(0)) raf(cb)
    }
  })
  await page.goto('/')
  // The client page is in the outlet, hidden: the server's page has hydrated.
  await expect(page.locator('litro-outlet > *')).toHaveCount(2)
  await expect(page.locator('litro-outlet[data-litro-settled]')).toHaveCount(0)
  const serverPage = page.locator('litro-outlet > :first-child')
  await serverPage.getByRole('tab', { name: 'Bluesky' }).click()
  // A reader clicks the field and types; `fill` sends no focus event.
  await serverPage.getByLabel('Bluesky handle').click()
  await page.keyboard.type('alice.example.com')
  await page.evaluate(() => (window as unknown as { __release(): void }).__release())
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'Bluesky' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Bluesky handle')).toHaveValue('alice.example.com')
  await expect(page.getByLabel('Bluesky handle')).toBeFocused()
})

// As `hydration-bootstrap.spec.ts`, for the landing: at the swap, the
// server's page hydrated in place, with one copy of each part.
test('the landing hydrates in place before the router swap', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(() => {
    const deep = (root: ParentNode, selector: string, out: Element[] = []): Element[] => {
      out.push(...root.querySelectorAll(selector))
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) deep(el.shadowRoot, selector, out)
      }
      return out
    }
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return
      const outlet = document.querySelector('litro-outlet')
      const serverPage = outlet?.firstElementChild
      if (!outlet || !serverPage?.shadowRoot) return
      const serverMain = deep(serverPage.shadowRoot, 'main')[0]
      const serverTabs = deep(serverPage.shadowRoot, '[role="tablist"]')[0]
      new MutationObserver((records) => {
        if (!records.some((r) => [...r.removedNodes].includes(serverPage))) return
        const root = serverPage.shadowRoot!
        const mains = deep(root, 'main')
        const tablists = deep(root, '[role="tablist"]')
        ;(window as unknown as { __atSwap: unknown }).__atSwap = {
          mains: mains.length,
          panels: deep(root, 'caribou-signin-panels').length,
          tablists: tablists.length,
          handles: deep(root, 'input[name="handle"]').length,
          servers: deep(root, 'input[name="server"]').length,
          mainIsServerNode: mains[0] === serverMain,
          tablistIsServerNode: tablists[0] === serverTabs,
          deferred: deep(root, '[defer-hydration]').map((el) => el.localName),
        }
      }).observe(outlet, { childList: true })
    })
  })
  await page.goto('/')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  expect(await page.evaluate(() => (window as unknown as { __atSwap?: unknown }).__atSwap)).toEqual({
    mains: 1, panels: 1, tablists: 1, handles: 1, servers: 1,
    mainIsServerNode: true, tablistIsServerNode: true, deferred: [],
  })
  expect(errors).toEqual([])
})

test('landing page shows error banner on ?error=denied and clears the param', async ({ page }) => {
  // Both mounts show the banner until the router's swap, so wait for one.
  await gotoSettled(page, '/?error=denied')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
  await expect.poll(() => page.url()).not.toContain('error=')
  // The banner outlives the URL clean-up.
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
})

test('landing page shows the session-expired banner from sessionStorage, once', async ({ page }) => {
  await gotoSettled(page, '/')
  await expect(page.getByRole('alert')).toHaveCount(0)

  await page.evaluate(() => sessionStorage.setItem('caribou.error', 'unauthorized'))
  await gotoSettled(page, '/')
  await expect(page.getByRole('alert')).toContainText(/your session expired/i)
  expect(await page.evaluate(() => sessionStorage.getItem('caribou.error'))).toBeNull()

  await gotoSettled(page, '/')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('submitting the picker POSTs /api/signin/start and follows the redirect', async ({ page }) => {
  let posted: unknown
  await page.route('**/api/signin/start', (route) => {
    posted = route.request().postDataJSON()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authorizeUrl: 'https://example.test/oauth/authorize?mock' }),
    })
  })
  // Intercept the eventual navigation to the fake instance to avoid leaving the site.
  await page.route('https://example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>authorize page</p>' }),
  )
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill('example.social')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/example\.test/)
  expect(page.url()).toContain('https://example.test/oauth/authorize?mock')
  expect(posted).toEqual({ server: 'example.social' })
})

// The form has no native submit button, so Enter relies on implicit
// submission of a form with a single text field.
test('Enter in the instance field submits the picker', async ({ page }) => {
  let posted: unknown
  await page.route('**/api/signin/start', (route) => {
    posted = route.request().postDataJSON()
    return route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
  })
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill('example.social')
  await page.getByLabel(/your mastodon instance/i).press('Enter')
  await expect(page.getByRole('alert')).toHaveText(
    'Could not reach that instance. Check the spelling and try again.',
  )
  expect(posted).toEqual({ server: 'example.social' })
})

test('the picker shows "Connecting…" and marks the button busy while it waits', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/api/signin/start', async (route) => {
    await held
    await route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
  })
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill('example.social')
  await page.getByRole('button', { name: /sign in/i }).click()

  // The label is slotted into the host; the role and the busy state are on
  // the inner button. `loading` keeps it focusable: aria-disabled, not disabled.
  const host = page.locator('caribou-instance-picker caribou-button')
  const button = host.getByRole('button')
  await expect(host).toHaveText(/connecting…/i)
  await expect(button).toBeDisabled()
  await expect(button).toHaveAttribute('aria-busy', 'true')

  release()
  await expect(host).toHaveText(/sign in/i)
  await expect(button).toBeEnabled()
})

test('the picker shows an error and stays on the page when the instance is rejected', async ({ page }) => {
  await page.route('**/api/signin/start', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: '{}' }),
  )
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill('nope.example')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Could not reach that instance. Check the spelling and try again.',
  )
  expect(new URL(page.url()).pathname).toBe('/')
})

test('the picker shows a network error when the request fails', async ({ page }) => {
  await page.route('**/api/signin/start', (route) => route.abort('failed'))
  await gotoSettled(page, '/')
  await page.getByLabel(/your mastodon instance/i).fill('example.social')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('alert')).toHaveText('Network error — try again.')
})

test('landing page has no a11y violations', async ({ page }) => {
  await gotoSettled(page, '/')
  const results = await new AxeBuilder({ page })
    .disableRules(['landmark-one-main', 'page-has-heading-one'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('health endpoint returns ok with build metadata', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
  expect(typeof body.commit).toBe('string')
  expect(body.commit.length).toBeGreaterThan(0)
  expect(typeof body.version).toBe('string')
  expect(body.version.length).toBeGreaterThan(0)
})
