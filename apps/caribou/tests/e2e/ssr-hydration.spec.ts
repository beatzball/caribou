import { expect, test } from '@playwright/test'

// The built app must HYDRATE the server-rendered page: Lit adopts the
// server's DOM and attaches to it. If hydration support is not installed
// before LitElement is evaluated, nothing throws — every server-rendered
// element just renders a second copy of its content in front of the server
// copy, and the copies stay until the router swaps the page out. The other
// specs cannot see that: no error is raised and the right content is there.
//
// This spec watches the server-rendered page from the moment the HTML is
// parsed, before any script runs, and checks two things:
//   - nothing is added beside the server's children (no second copy);
//   - every server child that waited with `defer-hydration` was hydrated.
//
// With no instance cookie the timeline routes render their auth-required
// placeholder, so no route here needs an upstream.
const ROUTES = ['/', '/about', '/privacy', '/blog', '/home', '/local', '/public']

interface HydrationReport {
  page: string | null
  hasShadowRoot: boolean
  serverChildren: string[]
  deferred: string[]
  added: string[]
  hydrated: string[]
}

for (const route of ROUTES) {
  test(`${route} hydrates the server-rendered page instead of rendering it again`, async ({ page }) => {
    await page.addInitScript(() => {
      // `interactive` = the document is parsed, and deferred and module
      // scripts have not run yet: the DOM is exactly what the server sent.
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'interactive') return
        const serverPage = document.querySelector('litro-outlet > *')
        const root = serverPage?.shadowRoot ?? null
        const report: HydrationReport = {
          page: serverPage?.localName ?? null,
          hasShadowRoot: root !== null,
          serverChildren: [], deferred: [], added: [], hydrated: [],
        }
        ;(window as unknown as { __hydrationReport: HydrationReport }).__hydrationReport = report
        if (!root) return
        for (const el of root.children) {
          if (el.localName === 'style') continue
          report.serverChildren.push(el.localName)
          if (el.hasAttribute('defer-hydration')) report.deferred.push(el.localName)
        }
        // Mutation records are still delivered after the router removes
        // the page from the document, so no frame can be missed.
        new MutationObserver((records) => {
          for (const record of records) {
            if (record.type === 'childList' && record.target === root) {
              for (const node of record.addedNodes) {
                if (node instanceof Element) report.added.push(node.localName)
              }
            }
            if (record.type === 'attributes' && record.target.parentNode === root
                && !(record.target as Element).hasAttribute('defer-hydration')) {
              report.hydrated.push((record.target as Element).localName)
            }
          }
        }).observe(root, {
          childList: true, subtree: true, attributes: true, attributeFilter: ['defer-hydration'],
        })
      })
    })

    await page.goto(route)
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    await expect(page.locator('litro-outlet > *')).toHaveCount(1)

    const report = await page.evaluate(
      () => (window as unknown as { __hydrationReport: HydrationReport }).__hydrationReport,
    )
    // The server sent a rendered page: a declarative shadow root with content.
    expect(report.page).toMatch(/^page-/)
    expect(report.hasShadowRoot).toBe(true)
    expect(report.serverChildren.length).toBeGreaterThan(0)
    // No second copy was rendered beside the server's children…
    expect(report.added).toEqual([])
    // …and the server's own children were hydrated.
    expect(report.hydrated).toEqual(report.deferred)
  })
}
