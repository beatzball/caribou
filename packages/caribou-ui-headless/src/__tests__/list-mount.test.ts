import { describe, it, expect, beforeEach } from 'vitest'
import '../list-mount.js'
import type { CaribouListMount } from '../list-mount.js'
import { Elena, html } from '@elenajs/core'

describe('<caribou-list-mount>', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('registers the custom element on import', () => {
    expect(customElements.get('caribou-list-mount')).toBeDefined()
  })

  it('attaches a shadow root and renders an internal <ul> on connectedCallback', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(m)
    expect(m.shadowRoot).not.toBeNull()
    const ul = m.shadowRoot!.querySelector('ul')
    expect(ul).not.toBeNull()
  })

  it('inner <ul> has list-style:none, margin:0, padding:0', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(m)
    const ul = m.shadowRoot!.querySelector('ul')!
    expect(ul.style.listStyle).toBe('none')
    expect(ul.style.margin).toBe('0px')
    expect(ul.style.padding).toBe('0px')
  })

  it('mountUl returns the same node identity across calls', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(m)
    expect(m.mountUl).toBe(m.mountUl)
  })

  it('mountUl is safe to access before connectedCallback fires (forces synchronous mount)', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    expect(() => m.mountUl).not.toThrow()
    expect(m.mountUl.tagName).toBe('UL')
  })

  it('shadow root persists across detach + re-attach to a different parent', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(m)
    const ulBefore = m.mountUl
    const otherParent = document.createElement('div')
    document.body.appendChild(otherParent)
    otherParent.appendChild(m)
    expect(m.mountUl).toBe(ulBefore)
  })

  it('importing the module twice does not throw on duplicate registration', async () => {
    // Re-importing is a no-op because the registration is guarded by
    // customElements.get('caribou-list-mount').
    await expect(import('../list-mount.js')).resolves.toBeDefined()
  })
})

describe('<caribou-list-mount> — morph isolation property', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('inner <ul> children survive an Elena host re-render (the property the validation POC §4 motivates)', async () => {
    class TestMountHost extends Elena(HTMLElement) {
      static override tagName = 'test-mount-host'
      static override props = [{ name: 'rev', reflect: true }]
      rev = 0
      override render() {
        return html`<div><caribou-list-mount></caribou-list-mount></div>`
      }
    }
    TestMountHost.define()

    const host = document.createElement('test-mount-host') as HTMLElement & { rev: number; requestUpdate?: () => void }
    document.body.appendChild(host)
    await new Promise((r) => setTimeout(r, 0))

    const mount = host.querySelector('caribou-list-mount') as CaribouListMount
    const ul = mount.mountUl
    const liA = document.createElement('li'); liA.dataset.key = 'a'
    const liB = document.createElement('li'); liB.dataset.key = 'b'
    ul.append(liA, liB)
    expect(ul.children.length).toBe(2)

    host.rev = 1
    host.requestUpdate?.()
    await new Promise((r) => setTimeout(r, 0))

    // Mount's shadow root is morph-opaque to the host's morph engine.
    expect(ul.children.length).toBe(2)
    expect(ul.children[0]).toBe(liA)
    expect(ul.children[1]).toBe(liB)
  })
})
