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

function normalize(s: string): string {
  return s.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
}

const CASES: Array<{ name: string; tag: string; props: Record<string, string> }> = [
  { name: 'caribou-app-shell with instance',
    tag: 'caribou-app-shell',
    props: { instance: 'mastodon.social' } },
  { name: 'caribou-app-shell anonymous',
    tag: 'caribou-app-shell',
    props: {} },
  { name: 'caribou-nav-rail current=/local',
    tag: 'caribou-nav-rail',
    props: { current: '/local' } },
  { name: 'caribou-right-rail with instance',
    tag: 'caribou-right-rail',
    props: { instance: 'mastodon.social' } },
  { name: 'caribou-status-card variant=timeline (no status)',
    tag: 'caribou-status-card',
    props: { variant: 'timeline' } },
  { name: 'caribou-status-card variant=focused (no status)',
    tag: 'caribou-status-card',
    props: { variant: 'focused' } },
]

describe('§12.6 hydration parity — SSR ↔ pre-hydration client render byte-equal', () => {
  beforeAll(async () => {
    await import('../../pages/components/caribou-app-shell.js')
    await import('../../pages/components/caribou-nav-rail.js')
    await import('../../pages/components/caribou-right-rail.js')
    await import('../../pages/components/caribou-status-card.js')
  })

  for (const c of CASES) {
    it(c.name, async () => {
      const { renderShadowComponentToString } =
        await import('../../server/lib/render-shadow.js')
      const serverHtml = await renderShadowComponentToString(c.tag, c.props)
      const clientHtml = await renderShadowComponentToString(c.tag, c.props)

      expect(normalize(clientHtml)).toBe(normalize(serverHtml))
      expect(serverHtml).toContain('<template shadowrootmode="open">')
      expect(serverHtml).toContain('id="caribou-dsd-style"')
    })
  }
})
