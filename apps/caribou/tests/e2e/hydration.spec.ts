import { expect, test, type Page } from '@playwright/test'

// What happened to the server-rendered page between the moment the browser
// parsed it and the moment the router took it out of the outlet. By the swap
// its module has loaded and every element in it has had its first update, so
// this is the result of hydration — or of the lack of it.
interface ServerPageAtSwap {
  // Elements in the page's tree, shadow roots included, as the server sent it.
  sent: number
  // Elements at the swap that the server did not send, as `parent > tag`.
  added: string[]
  // How many of the server's elements were gone from the tree at the swap.
  removed: number
  // Tags that still carry `defer-hydration`: their parent never hydrated.
  deferred: string[]
}

// An element that does not hydrate renders a second copy of its template
// beside the server's markup, and its children keep `defer-hydration`. An
// element that hydrates keeps every node the server sent. So each route says
// which elements the client may add after hydration, and nothing else may
// change. `/?error=denied` adds the alert: the server never has the code.
//
// With no instance cookie and no session the three timeline routes render
// their auth-required placeholder, so they need no upstream and add nothing.
const ROUTES: Array<{ route: string; adds: string[] }> = [
  { route: '/', adds: [] },
  { route: '/?error=denied', adds: ['caribou-error-banner > div'] },
  { route: '/about', adds: [] },
  { route: '/privacy', adds: [] },
  { route: '/blog', adds: [] },
  { route: '/blog/hello-world', adds: [] },
  { route: '/home', adds: [] },
  { route: '/local', adds: [] },
  { route: '/public', adds: [] },
]

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function watchServerPage(page: Page) {
  await page.addInitScript(() => {
    const deep = (root: ParentNode, out: Element[] = []): Element[] => {
      for (const el of root.querySelectorAll('*')) {
        out.push(el)
        if (el.shadowRoot) deep(el.shadowRoot, out)
      }
      return out
    }
    const parentTag = (el: Element): string => {
      const parent = el.parentNode
      if (parent instanceof ShadowRoot) return parent.host.localName
      return (parent as Element | null)?.localName ?? ''
    }
    // `interactive` comes before any module script runs: the markup, with
    // its declarative shadow roots, is still exactly what the server sent.
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return
      const outlet = document.querySelector('litro-outlet')
      const serverPage = outlet?.firstElementChild
      if (!outlet || !serverPage?.shadowRoot) return
      const sent = new Set(deep(serverPage.shadowRoot))
      new MutationObserver((records) => {
        if (!records.some((r) => [...r.removedNodes].includes(serverPage))) return
        const now = deep(serverPage.shadowRoot!)
        const kept = new Set(now)
        const snapshot: ServerPageAtSwap = {
          sent: sent.size,
          added: now.filter((el) => !sent.has(el)).map((el) => `${parentTag(el)} > ${el.localName}`),
          removed: [...sent].filter((el) => !kept.has(el)).length,
          deferred: now.filter((el) => el.hasAttribute('defer-hydration')).map((el) => el.localName),
        }
        ;(window as unknown as { __serverPageAtSwap: ServerPageAtSwap }).__serverPageAtSwap = snapshot
      }).observe(outlet, { childList: true })
    })
  })
}

for (const { route, adds } of ROUTES) {
  test(`${route} hydrates the server markup and settles with no errors`, async ({ page }) => {
    const errors = collectErrors(page)
    await watchServerPage(page)
    await page.goto(route)
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })

    const atSwap = await page.evaluate(
      () => (window as unknown as { __serverPageAtSwap?: ServerPageAtSwap }).__serverPageAtSwap,
    )
    expect(atSwap, 'the router should have swapped out a server-rendered page').toBeDefined()
    expect(atSwap!.sent).toBeGreaterThan(0)
    expect({ added: atSwap!.added, removed: atSwap!.removed, deferred: atSwap!.deferred })
      .toEqual({ added: adds, removed: 0, deferred: [] })

    // Exactly one page element is left after the router's swap.
    await expect(page.locator('litro-outlet > *')).toHaveCount(1)
    // Lit throws when the first client render differs from the server HTML;
    // the throw surfaces as a page error.
    expect(errors).toEqual([])
  })
}

// The server does not know the request path, so the nav rail renders no
// active item; it marks one from `location` after its first update.
test('the nav rail marks the active item with aria-current after hydration', async ({ page, request }) => {
  const body = await (await request.get('/local')).text()
  expect(body).not.toMatch(/<a [^>]*aria-current=/)

  await page.goto('/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  const localNav = page.locator('page-local caribou-nav-rail')
  await expect(localNav.getByRole('link', { name: 'Local' })).toHaveAttribute('aria-current', 'page')
  await expect(localNav.locator('a[aria-current]')).toHaveCount(1)

  // The mark follows a client-side navigation. The old and the new page
  // share the outlet for a moment, so scope to the page that is expected.
  await localNav.getByRole('link', { name: 'Public' }).click()
  await expect(page).toHaveURL(/\/public$/)
  const publicNav = page.locator('page-public caribou-nav-rail')
  await expect(publicNav.getByRole('link', { name: 'Public' })).toHaveAttribute('aria-current', 'page')
  await expect(publicNav.locator('a[aria-current]')).toHaveCount(1)
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
})

// During a client-side navigation the router holds the old and the new page
// in the outlet for a moment, so these tests scope their locators to the page
// they expect and then check that only one page is left.
test('a shell link navigates without a full page load', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/about')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true })

  await page.locator('caribou-right-rail').getByRole('link', { name: 'Privacy' }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.locator('page-privacy').getByRole('heading', { level: 1 })).toHaveText('Privacy')
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  expect(errors).toEqual([])
})

test('blog index → post → back, client-side, with the post data', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/blog')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true })

  await page.getByRole('link', { name: 'Getting Started' }).click()
  await expect(page).toHaveURL(/\/blog\/getting-started$/)
  await expect(page.locator('page-blog-slug').getByRole('heading', { level: 1 })).toHaveText('Post: getting-started')
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await expect(page.getByText('This is the content for the "getting-started" post.')).toBeVisible()

  await page.getByRole('link', { name: /back to blog/i }).click()
  await expect(page).toHaveURL(/\/blog$/)
  await expect(page.locator('page-blog').getByRole('heading', { level: 1 })).toHaveText('Blog')
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  expect(errors).toEqual([])
})
