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

// The cheaper check, from the same bug. Lit's hydration support patches
// LitElement once, when LitElement's module runs; one thing it adds is
// `defer-hydration` to `observedAttributes`, and every subclass inherits it.
// So a class without it proves the support ran too late, however the page
// looks. A check on the `defer-hydration` attribute itself cannot do that:
// the attribute leaves with the discarded server markup on a broken build.
test('every custom element on the page has the hydration support patched in', async ({ page }) => {
  await page.goto('/about')
  await page.waitForSelector('litro-outlet[data-litro-settled]', { state: 'attached' })

  const unpatched = await page.evaluate(() => {
    const names = new Set<string>()
    const walk = (root: ParentNode) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.localName.includes('-')) names.add(el.localName)
        if (el.shadowRoot) walk(el.shadowRoot)
      }
    }
    walk(document)
    return [...names].filter((name) => {
      const ctor = customElements.get(name) as (CustomElementConstructor & { observedAttributes?: string[] }) | undefined
      // An undefined element has no class to inspect; a class without
      // `elementProperties` is not a LitElement and has nothing to patch.
      if (!ctor || !('elementProperties' in ctor)) return false
      return !(ctor.observedAttributes ?? []).includes('defer-hydration')
    })
  })

  expect(unpatched).toEqual([])
  // The check must have looked at something: the page and the shell at least.
  const litElements = await page.evaluate(() =>
    ['page-about', 'caribou-app-shell'].filter((n) => 'elementProperties' in (customElements.get(n) ?? {})))
  expect(litElements).toEqual(['page-about', 'caribou-app-shell'])
})
