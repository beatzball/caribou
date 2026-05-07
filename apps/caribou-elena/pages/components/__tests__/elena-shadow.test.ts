import { describe, it, expect, beforeAll, vi } from 'vitest'
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

// Each call to `Elena(HTMLElement)` returns a fresh class, so we cannot
// spy on `elena.Elena(HTMLElement).prototype` and observe a different
// instance's behavior. Instead, walk the actual prototype chain of our
// component to reach the Base prototype the CaribouElena wrapper used.
type SpyableProto = Record<string, () => void>
function upstreamProtoOf(componentClass: { prototype: object }): SpyableProto {
  const componentProto = componentClass.prototype // e.g. TestComponent.prototype
  const caribouProto = Object.getPrototypeOf(componentProto) // CaribouShadowElena.prototype
  const upstreamProto = Object.getPrototypeOf(caribouProto) // Base (UpstreamElena result).prototype
  return upstreamProto as SpyableProto
}

describe('CaribouElena() — adoption-suppression wrapper', () => {
  it('skips upstream _attachShadow when <style id="caribou-dsd-style"> is first child of shadow root', async () => {
    const { CaribouElena } = await import('../elena-shadow.js')

    class TestComponent extends CaribouElena(HTMLElement) {
      static override tagName = 'test-suppress-shell'
      static override shadow = 'open' as const
      static override styles = ':host { color: red; }'
      override render() {
        return ''
      }
    }
    TestComponent.define()

    // Spy on the *actual* upstream prototype the wrapper closed over.
    const spy = vi.spyOn(upstreamProtoOf(TestComponent), '_attachShadow')

    // Build a DSD-prerendered host with the sentinel as first shadow child.
    const host = document.createElement('test-suppress-shell') as HTMLElement
    const shadow = host.attachShadow({ mode: 'open' })
    const sentinel = document.createElement('style')
    sentinel.id = 'caribou-dsd-style'
    sentinel.textContent = ':host { color: red; }'
    shadow.appendChild(sentinel)

    document.body.appendChild(host)
    // connectedCallback should have run and called our patched _attachShadow,
    // which in turn must have NOT called upstream's _attachShadow.
    expect(spy).not.toHaveBeenCalled()
    // Sentinel is still the first child after upgrade.
    expect(shadow.firstElementChild?.tagName).toBe('STYLE')
    expect((shadow.firstElementChild as HTMLStyleElement).id).toBe('caribou-dsd-style')

    document.body.removeChild(host)
    spy.mockRestore()
  })

  it('falls through to upstream _attachShadow when sentinel is absent', async () => {
    const { CaribouElena } = await import('../elena-shadow.js')

    class TestComponentB extends CaribouElena(HTMLElement) {
      static override tagName = 'test-fallthrough-shell'
      static override shadow = 'open' as const
      static override styles = ':host { color: blue; }'
      override render() {
        return ''
      }
    }
    TestComponentB.define()

    const spy = vi.spyOn(upstreamProtoOf(TestComponentB), '_attachShadow')

    // No DSD pre-attached shadow root → upstream path must run.
    const host = document.createElement('test-fallthrough-shell') as HTMLElement
    document.body.appendChild(host)
    expect(spy).toHaveBeenCalled()

    document.body.removeChild(host)
    spy.mockRestore()
  })
})
