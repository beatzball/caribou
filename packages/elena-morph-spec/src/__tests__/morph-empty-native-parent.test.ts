import { describe, it, expect, beforeEach } from 'vitest'
import { Elena, html } from '@elenajs/core'

/**
 * Behavioral spec for morph against empty native parents in the host
 * template — i.e., a host whose render() emits `<ul></ul>` empty while
 * the live `<ul>` has imperatively-inserted children.
 *
 * Confirmed 2026-05-10: morph wipes the live children to match the
 * empty template (consistent with the README's "morph always recurses
 * into native children" rule — native children's identity is the
 * parent template's responsibility).
 *
 * The two `it.fails` assertions below describe the property we'd WANT
 * Elena to hold (children survive). They are expected to fail today.
 * The day Elena's morph stops wiping native-empty-template children,
 * `it.fails` itself fails — alerting us that Caribou's
 * <caribou-list-mount> workaround can be retired.
 *
 * This is the same gotcha-pinning pattern used in
 * morph-custom-elements.test.ts §4 for light-DOM self-rendering
 * children getting wiped.
 */

class TestEmptyUlHost extends Elena(HTMLElement) {
  static override tagName = 'test-empty-ul-host'
  static override props = [{ name: 'rev', reflect: true }]
  rev = 0

  override render() {
    return html`<div><ul data-list></ul></div>`
  }
}
TestEmptyUlHost.define()

describe('morph behavior: empty native <ul> in template vs populated live <ul>', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it.fails('would preserve imperatively-inserted <li> children across host re-renders (Elena gotcha — currently wipes them)', async () => {
    const host = document.createElement('test-empty-ul-host') as HTMLElement & { rev: number; requestUpdate?: () => void }
    document.body.appendChild(host)
    await new Promise((r) => setTimeout(r, 0))

    const ul = host.querySelector('ul[data-list]')!
    const liA = document.createElement('li'); liA.textContent = 'a'; liA.dataset.key = 'a'
    const liB = document.createElement('li'); liB.textContent = 'b'; liB.dataset.key = 'b'
    const liC = document.createElement('li'); liC.textContent = 'c'; liC.dataset.key = 'c'
    ul.append(liA, liB, liC)

    expect(ul.children.length).toBe(3)

    host.rev = 1
    host.requestUpdate?.()
    await new Promise((r) => setTimeout(r, 0))

    // What we'd want Elena to do — but currently morph wipes these.
    expect(ul.children.length).toBe(3)
    expect(ul.children[0]).toBe(liA)
    expect(ul.children[1]).toBe(liB)
    expect(ul.children[2]).toBe(liC)
  })

  it.fails('would preserve children across two consecutive host re-renders (Elena gotcha)', async () => {
    const host = document.createElement('test-empty-ul-host') as HTMLElement & { rev: number; requestUpdate?: () => void }
    document.body.appendChild(host)
    await new Promise((r) => setTimeout(r, 0))

    const ul = host.querySelector('ul[data-list]')!
    const liA = document.createElement('li'); liA.dataset.key = 'a'
    ul.appendChild(liA)

    host.rev = 1; host.requestUpdate?.(); await new Promise((r) => setTimeout(r, 0))
    host.rev = 2; host.requestUpdate?.(); await new Promise((r) => setTimeout(r, 0))

    expect(ul.children.length).toBe(1)
    expect(ul.children[0]).toBe(liA)
  })

  it('observed behavior: morph wipes the children (this is the case Caribou works around with <caribou-list-mount>)', async () => {
    const host = document.createElement('test-empty-ul-host') as HTMLElement & { rev: number; requestUpdate?: () => void }
    document.body.appendChild(host)
    await new Promise((r) => setTimeout(r, 0))

    const ul = host.querySelector('ul[data-list]')!
    ul.append(
      Object.assign(document.createElement('li'), { textContent: 'a' }),
      Object.assign(document.createElement('li'), { textContent: 'b' }),
    )
    expect(ul.children.length).toBe(2)

    host.rev = 1
    host.requestUpdate?.()
    await new Promise((r) => setTimeout(r, 0))

    expect(ul.children.length).toBe(0) // morph wiped
  })
})
