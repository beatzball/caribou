// apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { TimelineStore } from '@beatzball/caribou-state'

beforeAll(async () => {
  await import('../caribou-timeline.js')
  // Force CaribouStatusCard._setupStaticProps to run so the Elena prop
  // descriptor for `status` is installed on the prototype before any test
  // tries to wrap it.
  const dummy = document.createElement('caribou-status-card')
  document.body.appendChild(dummy)
  document.body.removeChild(dummy)
})

const ACCT = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }
const mkStatus = (id: string) => ({
  id,
  content: `<p>${id}</p>`,
  account: ACCT,
  createdAt: '2026-05-08T12:00:00Z',
  inReplyToId: null,
})

// Helper: flush microtasks + one macrotask tick (Elena schedules renders with
// queueMicrotask, and some effects run in the next macrotask turn).
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('<caribou-timeline> — keyed reconciliation', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('keeps surviving card identity across applyNewPosts prepend', async () => {
    const tl = document.createElement('caribou-timeline') as HTMLElement & {
      kind: string
      initial: { statuses: unknown[]; nextMaxId: string | null }
    }
    tl.kind = 'home'
    const initial = Array.from({ length: 10 }, (_, i) => mkStatus(`s${i}`))
    tl.initial = { statuses: initial, nextMaxId: null }
    document.body.appendChild(tl)

    // Settle initial render.
    await flush()
    await flush()

    const mount = tl.querySelector('caribou-list-mount') as HTMLElement & { mountUl: HTMLUListElement }
    const ul = mount.mountUl
    const beforeRefs = Array.from(ul.children) as HTMLLIElement[]
    expect(beforeRefs).toHaveLength(10)

    // Inject 3 new statuses into the store's new-posts buffer, then trigger
    // applyNewPosts via the component's event listener.
    const newOnes = [mkStatus('n0'), mkStatus('n1'), mkStatus('n2')]
    const store = (tl as unknown as { store: TimelineStore }).store
    store._testOnlyPrepend(newOnes)
    // The timeline listens for 'apply-new-posts' and calls store.applyNewPosts().
    tl.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true }))

    await flush()
    await flush()

    const afterRefs = Array.from(ul.children) as HTMLLIElement[]
    expect(afterRefs).toHaveLength(13)
    // The original 10 should now occupy positions 3..12 with Object.is identity preserved.
    for (let i = 0; i < 10; i++) {
      expect(afterRefs[i + 3]).toBe(beforeRefs[i])
    }
  })

  it('does not fire caribou-status-card.status setter for surviving cards', async () => {
    const tl = document.createElement('caribou-timeline') as HTMLElement & {
      kind: string
      initial: { statuses: unknown[]; nextMaxId: string | null }
    }
    tl.kind = 'home'
    const initial = Array.from({ length: 5 }, (_, i) => mkStatus(`s${i}`))
    tl.initial = { statuses: initial, nextMaxId: null }
    document.body.appendChild(tl)

    // Settle initial render — status cards are created and connected here,
    // which triggers _setupStaticProps and installs the Elena setter on the
    // CaribouStatusCard prototype.
    await flush()
    await flush()

    // Now wrap the prototype setter.  _setupStaticProps has run, so the
    // descriptor is guaranteed to exist on the prototype at this point.
    const proto = customElements.get('caribou-status-card')!.prototype as Record<string, unknown>
    const originalDescriptor = Object.getOwnPropertyDescriptor(proto, 'status')
    let setterCalls = 0

    if (originalDescriptor?.set) {
      const origSet = originalDescriptor.set
      Object.defineProperty(proto, 'status', {
        ...originalDescriptor,
        set(this: unknown, v: unknown) {
          setterCalls++
          origSet.call(this, v)
        },
      })
    }

    try {
      // Reset counter — we only care about setter calls during the poll tick,
      // not the initial mount (which correctly fires the setter once per card).
      setterCalls = 0

      // poll() with no real client returns empty (clientSource returns null),
      // so newPostIds stays empty, the store's statusIds.value is unchanged,
      // the component's shallow-compare short-circuits, and reconcile() is
      // never called.  The setter must fire zero times.
      const store = (tl as unknown as { store: TimelineStore & { poll(): Promise<void> } }).store
      await store.poll()
      await flush()

      expect(setterCalls).toBe(0)
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(proto, 'status', originalDescriptor)
      }
    }
  })
})

describe('<caribou-timeline> — scroll preservation', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('preserves scrollTop across applyNewPosts prepend', async () => {
    // Wrap the timeline in a scrollable container so we can set scrollTop.
    const container = document.createElement('div')
    container.style.height = '400px'
    container.style.overflow = 'auto'
    document.body.appendChild(container)

    const tl = document.createElement('caribou-timeline') as HTMLElement & {
      kind: string; initial: { statuses: unknown[]; nextMaxId: string | null }
    }
    tl.kind = 'home'
    const initial = Array.from({ length: 50 }, (_, i) => mkStatus(`s${i}`))
    tl.initial = { statuses: initial, nextMaxId: null }
    container.appendChild(tl)

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    container.scrollTop = 800
    expect(container.scrollTop).toBe(800)

    // Prepend via the same path as the identity test in Task 12.
    const newOnes = [mkStatus('n0'), mkStatus('n1'), mkStatus('n2')]
    const store = (tl as unknown as { store: { _testOnlyPrepend?: (xs: unknown[]) => void } }).store
    if (store._testOnlyPrepend) {
      store._testOnlyPrepend(newOnes)
    } else {
      tl.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true }))
    }
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    // happy-dom maintains scrollTop across DOM mutations of preceding siblings
    // when nodes are MOVED, not recreated. This is the test that fails loudly
    // if the helper ever regresses to creating fresh <li>s for surviving
    // statuses.
    expect(container.scrollTop).toBe(800)
  })
})

describe('<caribou-timeline> — card-internal element identity', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('keeps card-internal <img> identity across applyNewPosts prepend', async () => {
    const tl = document.createElement('caribou-timeline') as HTMLElement & {
      kind: string; initial: { statuses: unknown[]; nextMaxId: string | null }
    }
    tl.kind = 'home'
    // Give one status an avatar so the card renders an <img>.
    const initial = [mkStatus('s0'), mkStatus('s1')]
    initial[0].account = { ...ACCT, avatar: 'https://example.test/a.png', avatarStatic: 'https://example.test/a.png' }
    tl.initial = { statuses: initial, nextMaxId: null }
    document.body.appendChild(tl)

    await flush()
    await flush()

    // Get the mount and ul to find the first card.
    const mount = tl.querySelector('caribou-list-mount') as HTMLElement & { mountUl: HTMLUListElement }
    const ul = mount.mountUl
    const firstLi = ul.children[0] as HTMLElement
    const firstCard = firstLi.firstElementChild as HTMLElement & { shadowRoot: ShadowRoot | null }
    const beforeImgRef = firstCard.shadowRoot!.querySelector('img')!
    const beforeLiRef = firstLi

    // Prepend.
    const store = (tl as unknown as { store: { _testOnlyPrepend?: (xs: unknown[]) => void } }).store
    store._testOnlyPrepend?.([mkStatus('n0')])
    // applyNewPosts processes newPostIds.value into statusIds
    tl.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true }))
    await flush()
    await flush()

    // Verify that the <li> itself was preserved (moved, not recreated).
    // The s0 card should now be at index 1 (after the new n0 at index 0).
    const survLi = ul.children[1] as HTMLElement
    expect(survLi).toBe(beforeLiRef)

    // Card s0 has moved from index 0 to index 1; its <img> should be the same node.
    const survivingCard = survLi.firstElementChild as HTMLElement
    const afterImgRef = survivingCard.shadowRoot!.querySelector('img')!

    // The object identity must be preserved to avoid avatar flicker.
    expect(afterImgRef).toBe(beforeImgRef)
  })
})
