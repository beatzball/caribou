import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'
import { renderShadowComponentToString } from '../render-shadow.js'

beforeAll(() => {
  // Need DOM globals for Elena's class registry. JSDOM's window provides
  // HTMLElement, customElements, document, etc. The component module is
  // imported lazily *after* the globals are wired so its module-eval-time
  // `class … extends HTMLElement` reads the JSDOM HTMLElement and registers
  // into the JSDOM customElements. We use beforeAll (not beforeEach) so the
  // dynamic-import cache and the customElements registry stay aligned: a
  // per-test `new JSDOM()` would hand back an empty registry while the
  // module-cached `define()` had already registered into the previous one.
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { window: typeof dom.window }).window = dom.window
  ;(globalThis as unknown as { document: Document }).document = dom.window.document as unknown as Document
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements as unknown as CustomElementRegistry
})

describe('renderShadowComponentToString', () => {
  it('wraps render() output in DSD template with adoption-suppression sentinel', async () => {
    await import('../../../pages/components/caribou-app-shell.js')
    const html = await renderShadowComponentToString('caribou-app-shell', {})
    expect(html).toContain('<caribou-app-shell')
    expect(html).toContain('<template shadowrootmode="open">')
    // Adoption-suppression sentinel — Elena skips static styles adoption
    // when this is the first child of the shadow root.
    expect(html).toMatch(/<style id="caribou-dsd-style">[\s\S]+<\/style>/)
    // The rendered template (a <slot> at minimum) sits after the <style>.
    expect(html).toContain('<slot></slot>')
    expect(html).toMatch(/<\/template>\s*<\/caribou-app-shell>/)
  })

  it('serializes string props as attributes on the host element', async () => {
    await import('../../../pages/components/caribou-app-shell.js')
    const html = await renderShadowComponentToString('caribou-app-shell', {
      instance: 'mastodon.social',
    })
    expect(html).toMatch(/<caribou-app-shell[^>]*\binstance="mastodon\.social"/)
  })
})
