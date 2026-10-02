import { expect, test } from '@playwright/test'

// On a full page load the router builds a second page element beside the
// server-rendered one, lets it render while it carries `hidden`, then swaps
// the two. `hidden` hides an element only while no author rule sets its
// `display` — and every page sets `:host { display: block }`. Without the
// document rule in `server/lib/base-head.ts` the "hidden" page is laid out
// under the first one: a one-frame flash of a doubled page, and two of
// everything for a locator that runs in that frame.
const ROUTES = ['/', '/about']

interface SwapReport {
  // Computed `display` of each element the router added with `hidden`,
  // read while it still had the attribute.
  hiddenPages: { tag: string; display: string }[]
  // On each animation frame: how many pages in the outlet are in the layout.
  laidOutPerFrame: number[]
}

for (const route of ROUTES) {
  test(`${route} keeps the pre-rendered page out of the layout until the swap`, async ({ page }) => {
    await page.addInitScript(() => {
      // `interactive` = the document is parsed and no module script has run.
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'interactive') return
        const outlet = document.querySelector('litro-outlet')
        const report: SwapReport = { hiddenPages: [], laidOutPerFrame: [] }
        ;(window as unknown as { __swapReport: SwapReport }).__swapReport = report
        if (!outlet) return

        // The callback runs in the microtask after the append, long before
        // the swap (the router first waits for a render and a frame).
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node instanceof HTMLElement && node.hasAttribute('hidden')) {
                report.hiddenPages.push({ tag: node.localName, display: getComputedStyle(node).display })
              }
            }
          }
        }).observe(outlet, { childList: true })

        const sample = () => {
          let laidOut = 0
          for (const child of outlet.children) {
            if (getComputedStyle(child).display !== 'none' && child.getBoundingClientRect().height > 0) laidOut++
          }
          report.laidOutPerFrame.push(laidOut)
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
    })

    await page.goto(route)
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    // Two more frames after the swap.
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))

    const report = await page.evaluate(
      () => (window as unknown as { __swapReport: SwapReport }).__swapReport,
    )
    // The router added exactly one page, hidden, and it really was hidden.
    expect(report.hiddenPages).toHaveLength(1)
    expect(report.hiddenPages[0]!.tag).toMatch(/^page-/)
    expect(report.hiddenPages[0]!.display).toBe('none')
    // On every frame — before, during and after the swap — one page shows.
    expect(report.laidOutPerFrame.length).toBeGreaterThan(2)
    expect([...new Set(report.laidOutPerFrame)]).toEqual([1])
  })
}
