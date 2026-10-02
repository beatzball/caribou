import type { Locator, Page } from '@playwright/test'

// The page the reader sees. During a navigation the router keeps the old
// page in the outlet and adds the next one with `hidden` until it has
// rendered, so for a moment the outlet holds two pages. A locator that must
// work in that window is scoped to this one.
export function livePage(page: Page): Locator {
  return page.locator('litro-outlet > :not([hidden])')
}

// What hydration did to the server-rendered page, read at the moment the
// router took that page out of the outlet.
export interface ServerPageReport {
  // Elements that match the selector in the markup the server sent.
  sent: number
  // The same count when the page left the outlet. More means the elements
  // were rendered a second time instead of hydrated.
  atSwap: number
  // True when they are the very nodes the server sent, in the same order.
  sameNodes: boolean
  // Tags that still carry `defer-hydration`: their parent never hydrated.
  deferred: string[]
}

// Call before `page.goto()`. `selector` names the elements to follow. It is
// run inside every shadow root of the server-rendered page, one root at a
// time, so it cannot span a shadow boundary: name the element by what it is
// inside its own root (`article[data-variant]`, not `my-card article`).
export async function watchServerPage(page: Page, selector: string): Promise<void> {
  await page.addInitScript((selector) => {
    const deep = (root: ParentNode, sel: string, out: Element[] = []): Element[] => {
      out.push(...root.querySelectorAll(sel))
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) deep(el.shadowRoot, sel, out)
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
      const sent = deep(serverPage.shadowRoot, selector)
      new MutationObserver((records) => {
        if (!records.some((r) => [...r.removedNodes].includes(serverPage))) return
        const atSwap = deep(serverPage.shadowRoot!, selector)
        const report: ServerPageReport = {
          sent: sent.length,
          atSwap: atSwap.length,
          sameNodes: atSwap.length === sent.length && atSwap.every((el, i) => el === sent[i]),
          deferred: deep(serverPage.shadowRoot!, '[defer-hydration]').map((el) => el.localName),
        }
        ;(window as unknown as { __serverPageReport: ServerPageReport }).__serverPageReport = report
      }).observe(outlet, { childList: true })
    })
  }, selector)
}

// Call after the router has settled.
export function serverPageReport(page: Page): Promise<ServerPageReport | undefined> {
  return page.evaluate(
    () => (window as unknown as { __serverPageReport?: ServerPageReport }).__serverPageReport,
  )
}
