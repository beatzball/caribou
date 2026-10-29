import { expect, test } from '@playwright/test'
import { SSR_MEDIA, SSR_STATUS_MEDIA } from './_status-media-ssr.js'

// A post's media, as the server prints it, hydrates in place: every node the
// server sent is the node the reader then uses. Replayed the way
// status-card-hydration.spec.ts replays a card: the media element waits with
// `defer-hydration` until its card sets `.media`.
test('server-rendered media hydrates without a second copy', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // The fixture's files do not exist; answer so no load error is logged.
  await page.route('https://files.example.social/**', (route) => route.fulfill({ status: 204 }))
  await page.goto('/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.waitForFunction(() => customElements.get('caribou-status-media') !== undefined)

  const result = await page.evaluate(async ({ markup, media }) => {
    type Lit = HTMLElement & { updateComplete: Promise<boolean>; media: unknown }
    const box = document.createElement('div')
    box.id = 'replay'
    box.setHTMLUnsafe(markup.replace('<caribou-status-media ', '<caribou-status-media defer-hydration '))
    const el = box.querySelector('caribou-status-media') as Lit
    const registry = customElements as CustomElementRegistry & { initialize?: (root: Node) => void }
    registry.initialize?.(el.shadowRoot!)
    const watched = 'a, img, video, button, [popover], dialog'
    const sent = [...el.shadowRoot!.querySelectorAll(watched)]
    document.body.append(box)
    el.media = media
    el.removeAttribute('defer-hydration')
    while (!(await el.updateComplete)) { /* settle the post-mount render */ }
    const now = [...el.shadowRoot!.querySelectorAll(watched)]
    return {
      kept: now.length === sent.length && now.every((n, i) => n === sent[i]),
      count: now.length,
      deferred: el.hasAttribute('defer-hydration'),
    }
  }, { markup: SSR_STATUS_MEDIA, media: SSR_MEDIA })

  expect(result).toEqual({ kept: true, count: 6, deferred: false })
  expect(errors).toEqual([])
})
