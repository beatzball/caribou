import { expect, test } from '@playwright/test'
import { SSR_LINK_CARD, SSR_STATUS_LINK_CARD } from './_status-link-card-ssr.js'

// A link card, as the server prints it, hydrates in place: every node the
// server sent is the node the reader then uses. Replayed the way
// status-media-hydration.spec.ts replays media.
test('a server-rendered link card hydrates without a second copy', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // The fixture's image does not exist; answer so no load error is logged.
  await page.route('https://files.example.social/**', (route) => route.fulfill({ status: 204 }))
  await page.goto('/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.waitForFunction(() => customElements.get('caribou-status-link-card') !== undefined)

  const result = await page.evaluate(async ({ markup, card }) => {
    type Lit = HTMLElement & { updateComplete: Promise<boolean>; card: unknown }
    const tag = 'caribou-status-link-card'
    const box = document.createElement('div')
    box.id = 'replay'
    box.setHTMLUnsafe(markup.replace(`<${tag} `, `<${tag} defer-hydration `))
    const el = box.querySelector(tag) as Lit
    const registry = customElements as CustomElementRegistry & { initialize?: (root: Node) => void }
    registry.initialize?.(el.shadowRoot!)
    const watched = 'a, img, span'
    const sent = [...el.shadowRoot!.querySelectorAll(watched)]
    document.body.append(box)
    el.card = card
    el.removeAttribute('defer-hydration')
    while (!(await el.updateComplete)) { /* settle the post-mount render */ }
    const now = [...el.shadowRoot!.querySelectorAll(watched)]
    return {
      kept: now.length === sent.length && now.every((n, i) => n === sent[i]),
      count: now.length,
      deferred: el.hasAttribute('defer-hydration'),
    }
  }, { markup: SSR_STATUS_LINK_CARD, card: SSR_LINK_CARD })

  expect(result).toEqual({ kept: true, count: 6, deferred: false })
  expect(errors).toEqual([])
})
