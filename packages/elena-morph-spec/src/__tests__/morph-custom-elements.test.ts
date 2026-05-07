/**
 * Behavioral spec for @elenajs/core's morph engine vs custom-element
 * children.
 *
 * Background: when an Elena component re-renders, `morphContent`
 * (in @elenajs/core/src/common/render.js) walks the existing DOM in
 * parallel with the freshly-rendered template fragment and recurses
 * into matching elements via `parent.childNodes`. `parent.childNodes`
 * is the standard DOM accessor for *light-DOM* children — it never
 * crosses a shadow root boundary. Therefore the platform's tree model
 * itself decides what morph can see:
 *
 *   - Custom element rendering into shadow DOM (`static shadow = 'open'`):
 *     its rendered tree lives in `host.shadowRoot`, NOT in
 *     `host.childNodes`. Morph cannot see it. The parent's template
 *     view of the host (typically `<my-card></my-card>` empty) reflects
 *     reality — the host has no light-DOM children. Re-renders are
 *     no-ops on the child's content.
 *
 *   - Custom element rendering into light DOM (default): its rendered
 *     tree IS the host's `childNodes`. Morph treats them as the
 *     parent's responsibility. If the parent's new template has the
 *     custom element with no children, morph removes the rendered
 *     content. The custom element's own state hasn't changed, so its
 *     setter doesn't fire `_safeRender`, and the wiped DOM stays wiped
 *     until something else forces a re-render.
 *
 *   - Slotted children: when the parent's template DOES include
 *     children inside the custom-element tag (the slot pattern), morph
 *     recursively reconciles them. The custom element opts into this
 *     by NOT using shadow DOM (or by placing a `<slot>` inside its
 *     shadow root).
 *
 *   - Native HTML elements: never affected by the above. Morph always
 *     recurses into native children — that's what the parent's template
 *     describes.
 *
 * This spec pins the *recommended* patterns (Section 1: shadow DOM for
 * self-rendering children) and the existing-semantics safety nets
 * (Section 2: slotted content; Section 3: native elements). Section 4
 * documents the gotcha (light-DOM self-rendering children get wiped)
 * with `it.fails` so a future Elena change that fixes it would also
 * get caught.
 *
 * The file is intentionally self-contained — same Vitest + happy-dom
 * setup runs without modification inside Elena's own repo.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Elena, html } from '@elenajs/core'

// Elena's `_safeRender` queues an update via `queueMicrotask`. After the
// microtask fires, `_performUpdate` runs render → updated(). Three
// awaited resolved-promises catches both the scheduling tick and any
// follow-up work updated() queues (e.g. child component prop assignments
// that in turn schedule child renders).
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  document.body.innerHTML = ''
})

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Shadow-DOM self-rendering custom elements (the recommended
// pattern). The child's rendered content lives in `host.shadowRoot`, so
// `parent.childNodes` never sees it and morph cannot wipe it. These
// tests pass on stock @elenajs/core@1.0.0 and document the architectural
// fix for the timeline-flicker bug Caribou hit.
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 1: shadow-DOM children survive parent re-render', () => {
  it('1a. preserves an <article> rendered into the child\'s shadow root', async () => {
    class ShadowChild1a extends Elena(HTMLElement) {
      static override tagName = 'morph-shadow-1a'
      static override shadow = 'open' as const
      override render() {
        return html`<article data-x>kept</article>`
      }
    }
    ShadowChild1a.define()

    class Parent1a extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-1a'
      static override props = [{ name: 'rev', reflect: false }]
      rev = 0
      override render() {
        return html`<div data-rev=${this.rev}><morph-shadow-1a></morph-shadow-1a></div>`
      }
    }
    Parent1a.define()

    const parent = document.createElement('morph-parent-1a') as InstanceType<typeof Parent1a>
    document.body.appendChild(parent)
    await flush()

    const child = parent.querySelector('morph-shadow-1a') as HTMLElement
    const before = child.shadowRoot!.querySelector('article[data-x]')
    expect(before, 'rendered into shadow root').not.toBeNull()
    expect(before!.textContent).toBe('kept')

    parent.rev = 1
    await flush()

    expect(parent.querySelector('div')!.getAttribute('data-rev')).toBe('1')
    const after = child.shadowRoot!.querySelector('article[data-x]')
    expect(after, 'shadow-DOM content survives parent re-render').toBe(before)
  })

  it('1b. preserves child component state across parent re-render', async () => {
    class ShadowChild1b extends Elena(HTMLElement) {
      static override tagName = 'morph-shadow-1b'
      static override shadow = 'open' as const
      static override props = [{ name: 'count', reflect: false }]
      count = 7
      override render() {
        return html`<span data-c>${this.count}</span>`
      }
    }
    ShadowChild1b.define()

    class Parent1b extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-1b'
      static override props = [{ name: 'rev', reflect: false }]
      rev = 0
      override render() {
        return html`<div data-rev=${this.rev}><morph-shadow-1b></morph-shadow-1b></div>`
      }
    }
    Parent1b.define()

    const parent = document.createElement('morph-parent-1b') as InstanceType<typeof Parent1b>
    document.body.appendChild(parent)
    await flush()

    const child = parent.querySelector('morph-shadow-1b') as InstanceType<typeof ShadowChild1b>
    const span = child.shadowRoot!.querySelector('span[data-c]')!
    expect(span.textContent).toBe('7')

    parent.rev = 1
    await flush()

    expect(child.shadowRoot!.querySelector('span[data-c]')).toBe(span)
    expect(span.textContent).toBe('7')
    expect(child.count).toBe(7)
  })

  it('1c. preserves an <img> node\'s identity (avatar flicker scenario from caribou)', async () => {
    // Real-world reproduction: a status card renders an <img> for the
    // poster's avatar. Before shadow DOM, parent re-renders wiped the
    // card and the browser re-fetched + re-painted the image, causing
    // visible flicker. With shadow DOM, the image is in the child's
    // shadow root and parent morph can't reach it.
    class ShadowChild1c extends Elena(HTMLElement) {
      static override tagName = 'morph-shadow-1c'
      static override shadow = 'open' as const
      override render() {
        return html`<article><img src="https://example.invalid/a.png" alt="" /></article>`
      }
    }
    ShadowChild1c.define()

    class Parent1c extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-1c'
      static override props = [{ name: 'rev', reflect: false }]
      rev = 0
      override render() {
        return html`<ul data-rev=${this.rev}><li><morph-shadow-1c></morph-shadow-1c></li></ul>`
      }
    }
    Parent1c.define()

    const parent = document.createElement('morph-parent-1c') as InstanceType<typeof Parent1c>
    document.body.appendChild(parent)
    await flush()

    const child = parent.querySelector('morph-shadow-1c') as HTMLElement
    const imgBefore = child.shadowRoot!.querySelector('img')!
    expect(imgBefore).not.toBeNull()

    parent.rev = 1
    await flush()

    expect(child.shadowRoot!.querySelector('img')).toBe(imgBefore)
  })

  it('1d. preserves all sibling shadow-DOM self-renderers in a list', async () => {
    class ShadowChild1d extends Elena(HTMLElement) {
      static override tagName = 'morph-shadow-1d'
      static override shadow = 'open' as const
      override render() {
        return html`<article data-x>kept</article>`
      }
    }
    ShadowChild1d.define()

    class Parent1d extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-1d'
      static override props = [{ name: 'rev', reflect: false }]
      rev = 0
      override render() {
        return html`<ul data-rev=${this.rev}>
          <li><morph-shadow-1d></morph-shadow-1d></li>
          <li><morph-shadow-1d></morph-shadow-1d></li>
          <li><morph-shadow-1d></morph-shadow-1d></li>
        </ul>`
      }
    }
    Parent1d.define()

    const parent = document.createElement('morph-parent-1d') as InstanceType<typeof Parent1d>
    document.body.appendChild(parent)
    await flush()

    const children = Array.from(parent.querySelectorAll('morph-shadow-1d')) as HTMLElement[]
    expect(children).toHaveLength(3)
    const articlesBefore = children.map((c) => c.shadowRoot!.querySelector('article[data-x]')!)
    expect(articlesBefore.every(Boolean)).toBe(true)

    parent.rev = 1
    await flush()

    const articlesAfter = Array.from(parent.querySelectorAll('morph-shadow-1d')).map(
      (c) => (c as HTMLElement).shadowRoot!.querySelector('article[data-x]')!,
    )
    articlesAfter.forEach((a, i) => {
      expect(a, `sibling #${i} keeps shadow-DOM identity`).toBe(articlesBefore[i])
    })
  })

  it('1e. survives 10 rapid parent re-renders without ever replacing the child\'s shadow DOM', async () => {
    class ShadowChild1e extends Elena(HTMLElement) {
      static override tagName = 'morph-shadow-1e'
      static override shadow = 'open' as const
      override render() {
        return html`<article data-x>kept</article>`
      }
    }
    ShadowChild1e.define()

    class Parent1e extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-1e'
      static override props = [{ name: 'rev', reflect: false }]
      rev = 0
      override render() {
        return html`<div data-rev=${this.rev}><morph-shadow-1e></morph-shadow-1e></div>`
      }
    }
    Parent1e.define()

    const parent = document.createElement('morph-parent-1e') as InstanceType<typeof Parent1e>
    document.body.appendChild(parent)
    await flush()
    const child = parent.querySelector('morph-shadow-1e') as HTMLElement
    const articleBefore = child.shadowRoot!.querySelector('article[data-x]')!

    for (let i = 1; i <= 10; i++) {
      parent.rev = i
      await flush()
      expect(
        child.shadowRoot!.querySelector('article[data-x]'),
        `rev=${i}: shadow-DOM article still the same node`,
      ).toBe(articleBefore)
    }
  })

  it('1f. updates host attributes across parent re-render even though shadow content is preserved', async () => {
    // The patch question only ever concerned child-recursion. Host
    // attributes still flow through morphAttributes. This pins that.
    class ShadowChild1f extends Elena(HTMLElement) {
      static override tagName = 'morph-shadow-1f'
      static override shadow = 'open' as const
      override render() {
        return html`<article>kept</article>`
      }
    }
    ShadowChild1f.define()

    class Parent1f extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-1f'
      static override props = [{ name: 'sid', reflect: false }]
      sid = 'a'
      override render() {
        return html`<morph-shadow-1f data-status-id=${this.sid}></morph-shadow-1f>`
      }
    }
    Parent1f.define()

    const parent = document.createElement('morph-parent-1f') as InstanceType<typeof Parent1f>
    document.body.appendChild(parent)
    await flush()

    const child = parent.querySelector('morph-shadow-1f')!
    expect(child.getAttribute('data-status-id')).toBe('a')

    parent.sid = 'b'
    await flush()

    expect(child.getAttribute('data-status-id'), 'host attributes morph as expected').toBe('b')
    expect((child as HTMLElement).shadowRoot!.querySelector('article')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — Slotted content (parent owns the children).
//
// When the parent's template DOES place children inside a custom-element
// tag, morph reconciles them normally. This is independent of shadow
// DOM — works either way. In a real shadow-DOM component, the child
// would render `<slot>` to project these into its tree.
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 2: slotted content under custom elements still morphs', () => {
  it('2a. updates slotted text when a parent prop changes', async () => {
    class Wrap2a extends Elena(HTMLElement) {
      static override tagName = 'morph-wrap-2a'
    }
    Wrap2a.define()

    class Parent2a extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-2a'
      static override props = [{ name: 'heading', reflect: false }]
      heading = 'first'
      override render() {
        return html`<morph-wrap-2a><h2 data-t>${this.heading}</h2></morph-wrap-2a>`
      }
    }
    Parent2a.define()

    const parent = document.createElement('morph-parent-2a') as InstanceType<typeof Parent2a>
    document.body.appendChild(parent)
    await flush()

    const h2Before = parent.querySelector('h2[data-t]')!
    expect(h2Before.textContent).toBe('first')

    parent.heading = 'second'
    await flush()

    const h2After = parent.querySelector('h2[data-t]')!
    expect(h2After).toBe(h2Before)
    expect(h2After.textContent).toBe('second')
  })

  it('2b. adds and removes slotted children as the parent template grows/shrinks', async () => {
    class Wrap2b extends Elena(HTMLElement) {
      static override tagName = 'morph-wrap-2b'
    }
    Wrap2b.define()

    class Parent2b extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-2b'
      static override props = [{ name: 'showB', reflect: false }]
      showB = false
      override render() {
        return this.showB
          ? html`<morph-wrap-2b><p data-a>A</p><p data-b>B</p></morph-wrap-2b>`
          : html`<morph-wrap-2b><p data-a>A</p></morph-wrap-2b>`
      }
    }
    Parent2b.define()

    const parent = document.createElement('morph-parent-2b') as InstanceType<typeof Parent2b>
    document.body.appendChild(parent)
    await flush()
    expect(parent.querySelector('p[data-a]')).not.toBeNull()
    expect(parent.querySelector('p[data-b]')).toBeNull()

    parent.showB = true
    await flush()
    expect(parent.querySelector('p[data-a]')).not.toBeNull()
    expect(parent.querySelector('p[data-b]')).not.toBeNull()

    parent.showB = false
    await flush()
    expect(parent.querySelector('p[data-a]')).not.toBeNull()
    expect(parent.querySelector('p[data-b]')).toBeNull()
  })

  it('2c. swaps slotted element type when the parent template changes it', async () => {
    class Wrap2c extends Elena(HTMLElement) {
      static override tagName = 'morph-wrap-2c'
    }
    Wrap2c.define()

    class Parent2c extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-2c'
      static override props = [{ name: 'mode', reflect: false }]
      mode: 'span' | 'strong' = 'span'
      override render() {
        return this.mode === 'span'
          ? html`<morph-wrap-2c><span data-x>hi</span></morph-wrap-2c>`
          : html`<morph-wrap-2c><strong data-x>hi</strong></morph-wrap-2c>`
      }
    }
    Parent2c.define()

    const parent = document.createElement('morph-parent-2c') as InstanceType<typeof Parent2c>
    document.body.appendChild(parent)
    await flush()
    expect(parent.querySelector('span[data-x]')).not.toBeNull()

    parent.mode = 'strong'
    await flush()
    expect(parent.querySelector('span[data-x]')).toBeNull()
    expect(parent.querySelector('strong[data-x]')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Native HTML elements still recurse into morph normally.
// Native tag names never contain a hyphen, so they're outside any
// custom-element heuristic and morph reconciles their children as
// expected. Pinning this prevents regressions.
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 3: native elements morph normally', () => {
  it('3a. removes children from a native <div> when the new template has none', async () => {
    class Parent3a extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-3a'
      static override props = [{ name: 'mode', reflect: false }]
      mode: 'with' | 'without' = 'with'
      override render() {
        return this.mode === 'with'
          ? html`<div data-d><p data-p>inside</p></div>`
          : html`<div data-d></div>`
      }
    }
    Parent3a.define()

    const parent = document.createElement('morph-parent-3a') as InstanceType<typeof Parent3a>
    document.body.appendChild(parent)
    await flush()
    expect(parent.querySelector('p[data-p]')).not.toBeNull()

    parent.mode = 'without'
    await flush()
    expect(parent.querySelector('p[data-p]')).toBeNull()
    expect(parent.querySelector('div[data-d]')).not.toBeNull()
  })

  it('3b. native element with a hyphen in its CLASS attribute is still treated as native', async () => {
    class Parent3b extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-3b'
      static override props = [{ name: 'mode', reflect: false }]
      mode: 'with' | 'without' = 'with'
      override render() {
        return this.mode === 'with'
          ? html`<div class="foo-bar" data-d><p data-p>inside</p></div>`
          : html`<div class="foo-bar" data-d></div>`
      }
    }
    Parent3b.define()

    const parent = document.createElement('morph-parent-3b') as InstanceType<typeof Parent3b>
    document.body.appendChild(parent)
    await flush()
    expect(parent.querySelector('p[data-p]')).not.toBeNull()

    parent.mode = 'without'
    await flush()
    expect(parent.querySelector('p[data-p]')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — Documented Elena tradeoff: light-DOM self-rendering custom
// elements get wiped on parent re-render. This is not a bug per se — it's
// an intentional consequence of light-DOM-by-default (the parent's morph
// engine treats the child's `childNodes` as its own to manage). Caribou
// hit this in the timeline-flicker incident; the fix was to either
// (a) move the child to shadow DOM (Section 1's pattern) or (b) make the
// parent re-render less frequently (caribou-timeline's split-bindings).
//
// `it.fails` makes these run as "expected failures": the assertion below
// is what we'd want, but Elena's current semantics violate it. If a future
// Elena change introduced a way for light-DOM components to opt out of
// parent-driven wipe (without a generic shadow-DOM workaround), these
// would start passing — and `it.fails` would correctly turn that into a
// red test, prompting the spec to be updated.
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 4: light-DOM self-rendering children — documented tradeoff', () => {
  it.fails('4a. light-DOM child\'s rendered article is currently wiped on parent re-render', async () => {
    class LightChild4a extends Elena(HTMLElement) {
      static override tagName = 'morph-light-4a'
      override render() {
        return html`<article data-x>kept</article>`
      }
    }
    LightChild4a.define()

    class Parent4a extends Elena(HTMLElement) {
      static override tagName = 'morph-parent-4a'
      static override props = [{ name: 'rev', reflect: false }]
      rev = 0
      override render() {
        return html`<div data-rev=${this.rev}><morph-light-4a></morph-light-4a></div>`
      }
    }
    Parent4a.define()

    const parent = document.createElement('morph-parent-4a') as InstanceType<typeof Parent4a>
    document.body.appendChild(parent)
    await flush()
    const before = parent.querySelector('article[data-x]')
    expect(before).not.toBeNull()

    parent.rev = 1
    await flush()

    // Documented limitation: this assertion fails on stock Elena because
    // `morphContent` recurses into the host's light-DOM `childNodes` and
    // strips the article. The `it.fails` wrapper captures that.
    const after = parent.querySelector('article[data-x]')
    expect(after).toBe(before)
  })
})
