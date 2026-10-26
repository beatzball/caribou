import { afterEach, describe, expect, it } from 'vitest'
import { updating } from '../_page-cache.js'
import '../caribou-update-notice.js'
import type { CaribouUpdateNotice } from '../caribou-update-notice.js'

afterEach(() => {
  document.body.replaceChildren()
  updating.value = 0
})

describe('<caribou-update-notice>', () => {
  // The real order: the notice is on the page from start-up, empty, and only
  // its text changes when a refresh starts — the change a reader hears.
  it('is an empty live region until a refresh starts, then says "Updating…"', async () => {
    const el = document.createElement('caribou-update-notice') as CaribouUpdateNotice
    document.body.append(el)
    await el.updateComplete
    const region = el.shadowRoot!.querySelector('[role="status"]')!
    expect(region.textContent).toBe('')
    updating.value = 1
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('[role="status"]')).toBe(region)
    expect(region.textContent).toBe('Updating…')
    updating.value = 0
    await el.updateComplete
    expect(region.textContent).toBe('')
  })

  it('never hides the region with display: none', () => {
    const css = (customElements.get('caribou-update-notice') as unknown as typeof CaribouUpdateNotice)
      .styles!.toString()
    expect(css).not.toMatch(/display:\s*none/)
  })
})
