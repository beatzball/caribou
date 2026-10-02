import { expect, test } from '@playwright/test'

// What the server-rendered page looked like at the moment the router took it
// out of the outlet. By then its module has loaded and every element in it
// has had its first update, so this is the result of hydration — or of the
// lack of it.
interface ServerPageAtSwap {
  // Elements in the page's shadow tree, at any depth, by tag name.
  shells: number
  mains: number
  navs: number
  // True when the one <main> is the node the server sent, not a new one.
  mainIsServerNode: boolean
  // Tags that still carry `defer-hydration`: their parent never hydrated.
  deferred: string[]
}

// Regression test for the client bootstrap (`app.ts`).
//
// LitElement reads Lit's hydration support once, when its module runs. When
// the bundler ran LitElement first, no element hydrated: each one rendered a
// second copy of itself next to the server's markup, inside the same shadow
// root. The router's swap then removed the doubled page, so nothing showed
// after the page settled — the damage is only there before the swap, which is
// where this test looks.
test('the server-rendered page is hydrated, not rendered a second time', async ({ page }) => {
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
    // `interactive` comes before any module script runs: the markup, with
    // its declarative shadow roots, is still exactly what the server sent.
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return
      const outlet = document.querySelector('litro-outlet')
      const serverPage = outlet?.firstElementChild
      if (!outlet || !serverPage?.shadowRoot) return
      const serverMain = deep(serverPage.shadowRoot, 'main')[0]
      new MutationObserver((records) => {
        const removed = records.some((r) => [...r.removedNodes].includes(serverPage))
        if (!removed) return
        const root = serverPage.shadowRoot!
        const mains = deep(root, 'main')
        const snapshot: ServerPageAtSwap = {
          shells: deep(root, 'caribou-app-shell').length,
          mains: mains.length,
          navs: deep(root, 'nav').length,
          mainIsServerNode: mains[0] === serverMain,
          deferred: deep(root, '[defer-hydration]').map((el) => el.localName),
        }
        ;(window as unknown as { __serverPageAtSwap: ServerPageAtSwap }).__serverPageAtSwap = snapshot
      }).observe(outlet, { childList: true })
    })
  })

  await page.goto('/about')
  await page.waitForSelector('litro-outlet[data-litro-settled]', { state: 'attached' })
  const atSwap = await page.evaluate(
    () => (window as unknown as { __serverPageAtSwap?: ServerPageAtSwap }).__serverPageAtSwap,
  )

  expect(atSwap).toEqual({
    shells: 1,
    mains: 1,
    navs: 1,
    mainIsServerNode: true,
    deferred: [],
  })
  expect(errors).toEqual([])
})
