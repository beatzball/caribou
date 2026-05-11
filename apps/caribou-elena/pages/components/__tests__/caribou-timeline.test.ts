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
