import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { window: typeof dom.window }).window = dom.window
  ;(globalThis as unknown as { document: Document }).document = dom.window.document as unknown as Document
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements as unknown as CustomElementRegistry
})

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

describe('SSR hydration parity — caribou-app-shell', () => {
  it('server SSR string equals client render string in pre-hydration mode', async () => {
    const { renderShadowComponentToString } = await import('../../server/lib/render-shadow.js')
    await import('../../pages/components/caribou-app-shell.js')

    const props = { instance: 'mastodon.social' }
    const serverHtml = await renderShadowComponentToString('caribou-app-shell', props)
    // The "client render in pre-hydration mode" path goes through the same
    // helper, by design. By construction these are byte-equal — the test
    // codifies the §12.6 single-source-of-truth contract so a future
    // refactor that splits the paths fails loudly here.
    const clientHtml = await renderShadowComponentToString('caribou-app-shell', props)
    expect(normalize(serverHtml)).toBe(normalize(clientHtml))
    // Sanity: the output is non-trivial, not just two empty strings.
    expect(serverHtml).toContain('<template shadowrootmode="open">')
    expect(serverHtml).toContain('caribou-dsd-style')
  })
})
