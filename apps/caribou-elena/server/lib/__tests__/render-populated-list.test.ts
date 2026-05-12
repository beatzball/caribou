import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { window: typeof dom.window }).window = dom.window
  ;(globalThis as unknown as { document: Document }).document =
    dom.window.document as unknown as Document
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements as unknown as CustomElementRegistry
})

beforeAll(async () => {
  await import('../../../pages/components/caribou-status-card.js')
})

describe('renderPopulatedListMount — empty', () => {
  it('emits a mount with an empty <ul> when items is empty', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const html = await renderPopulatedListMount({ items: [], serverNowMs: 1700000000000 })
    expect(html).toContain('<caribou-list-mount>')
    expect(html).toContain('<template shadowrootmode="open">')
    expect(html).toContain('<ul')
    expect(html).toContain('</ul>')
    expect(html).not.toContain('<li')
  })
})
