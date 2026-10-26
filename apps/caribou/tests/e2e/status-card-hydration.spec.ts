import { expect, test } from '@playwright/test'
import { SSR_STATUS, SSR_STATUS_CARD } from './_status-card-ssr.js'

// The status card is the first shared-control consumer the server renders:
// four `<caribou-icon-button>`s per card, each with a nested `<caribou-icon>`,
// all as declarative shadow roots. With no instance cookie a timeline route
// renders no cards in CI (the server would fetch a real instance; see
// public-timeline.spec.ts for that run), so this replays real server markup
// into a page that has loaded the timeline, and lets Lit hydrate it. The card
// waits for its `.status` the way a timeline's card does, then hydrates.
test('a server-rendered status card hydrates its action buttons without a second copy', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.waitForFunction(() => customElements.get('caribou-status-card') !== undefined)

  const state = await page.evaluate(async ({ markup, status }) => {
    type Lit = HTMLElement & { updateComplete: Promise<boolean> }
    const deep = (root: ParentNode, sel: string, out: Element[] = []): Element[] => {
      out.push(...root.querySelectorAll(sel))
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deep(el.shadowRoot, sel, out)
      return out
    }
    // A timeline's card waits with `defer-hydration` until its parent has
    // set `.status`; do the same, so nothing hydrates before the snapshot
    // below. setHTMLUnsafe parses declarative shadow roots, as page load
    // does.
    const box = document.createElement('div')
    box.setHTMLUnsafe(markup.replace('<caribou-status-card ', '<caribou-status-card defer-hydration '))
    // Chromium (scoped registries) gives the elements inside a shadow root
    // that setHTMLUnsafe made no registry, so they never upgrade. A page
    // load uses the document's registry; hand each root that registry.
    const registry = customElements as CustomElementRegistry & { initialize?: (root: Node) => void }
    for (const host of [box, ...deep(box, '*')]) if (host.shadowRoot) registry.initialize?.(host.shadowRoot)
    const card = box.querySelector('caribou-status-card') as Lit & { status: unknown }
    const sent = deep(card.shadowRoot!, 'caribou-icon-button, caribou-icon, button')
    document.body.append(box)
    card.status = status
    card.removeAttribute('defer-hydration')
    while (!(await card.updateComplete)) { /* settle the post-mount render */ }
    const hosts: Lit[] = [...card.shadowRoot!.querySelectorAll('caribou-icon-button')]
    await Promise.all(hosts.map((h) => h.updateComplete))
    const now = deep(card.shadowRoot!, 'caribou-icon-button, caribou-icon, button')
    return {
      kept: now.length === sent.length && now.every((el, i) => el === sent[i]),
      buttonsPerControl: hosts.map((h) => h.shadowRoot!.querySelectorAll('button').length),
      deferred: deep(card.shadowRoot!, '[defer-hydration]').map((el) => el.localName),
      actions: hosts.map((h) => {
        const b = h.shadowRoot!.querySelector('button')!
        return [b.getAttribute('aria-label'), b.getAttribute('aria-pressed'), b.getAttribute('aria-disabled'), b.title]
      }),
    }
  }, { markup: SSR_STATUS_CARD, status: SSR_STATUS })

  expect(state).toEqual({
    kept: true,
    buttonsPerControl: [1, 1, 1, 1],
    deferred: [],
    // Signed out: every action is soft-disabled with its sign-in hint.
    actions: [
      ['Reply', null, 'true', 'Sign in to reply'],
      ['Boost', 'false', 'true', 'Sign in to boost'],
      ['Unfavourite', 'true', 'true', 'Sign in to favourite'],
      ['Bookmark', 'false', 'true', 'Sign in to bookmark'],
    ],
  })
  expect(errors).toEqual([])
})
