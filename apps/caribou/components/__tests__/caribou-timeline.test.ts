import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, statusCache, users, type TimelineStore } from '@beatzball/caribou-state'
import '../caribou-timeline.js'
import type { CaribouTimeline, TimelineInitial, TimelineKind } from '../caribou-timeline.js'
import { CaribouStatusCard } from '../caribou-status-card.js'

const ACCT = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }
const mkStatus = (id: string) => ({
  id,
  content: `<p>${id}</p>`,
  account: ACCT,
  createdAt: '2026-05-08T12:00:00Z',
  inReplyToId: null,
})
type Fixture = ReturnType<typeof mkStatus>

// Fixtures leave out the long tail of Status fields the timeline never
// reads; the casts stay at the two seams that take real statuses.
const asInitial = (statuses: Fixture[], nextMaxId: string | null = null) =>
  ({ statuses, nextMaxId }) as unknown as TimelineInitial
const asStatuses = (xs: Fixture[]) => xs as unknown as Parameters<TimelineStore['_testOnlyPrepend']>[0]

// A signal behind the store's read-only type is writable; tests drive the
// loading and error states through it.
type Writable<T> = { value: T }

// Gives the store a client, as a signed-in browser has. No test lets that
// client reach the network: the paging tests replace `store.loadMore`.
function signIn() {
  const userKey = 'alice@example.social' as NonNullable<typeof activeUserKey.value>
  users.value = new Map([[userKey, {
    userKey, server: 'example.social', token: 'TOKEN', vapidKey: '', createdAt: 1,
    account: {} as never,
  }]])
  activeUserKey.value = userKey
}

const storeOf = (tl: CaribouTimeline) => (tl as unknown as { store: TimelineStore }).store

// The timeline and its cards each finish in their own update; a card also
// schedules a second one (absolute → relative time).
async function settle(tl: CaribouTimeline) {
  while (!(await tl.updateComplete)) { /* until no update is pending */ }
  for (const card of tl.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')) {
    while (!(await card.updateComplete)) { /* same for each card */ }
  }
}

async function mount(
  kind: TimelineKind, initial: TimelineInitial | null, parent: Element = document.body,
): Promise<CaribouTimeline> {
  const tl = document.createElement('caribou-timeline') as CaribouTimeline
  tl.kind = kind
  tl.initial = initial
  parent.appendChild(tl)
  await settle(tl)
  return tl
}

const listItems = (tl: CaribouTimeline) =>
  Array.from(tl.shadowRoot!.querySelector('ul')!.children) as HTMLLIElement[]
const banner = (tl: CaribouTimeline) => tl.shadowRoot!.querySelector('caribou-new-posts-banner')!
const bannerButton = (tl: CaribouTimeline) => banner(tl).shadowRoot!.querySelector('button')
const sentinel = (tl: CaribouTimeline) => tl.shadowRoot!.querySelector<HTMLAnchorElement>('a[data-sentinel]')

// Stand-in observer: records what is observed and lets a test fire an entry.
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  targets = new Set<Element>()
  observeCalls = 0
  constructor(private callback: (entries: IntersectionObserverEntry[]) => void) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) { this.targets.add(el); this.observeCalls++ }
  unobserve(el: Element) { this.targets.delete(el) }
  disconnect() { this.targets.clear() }
  fire(isIntersecting: boolean) {
    this.callback([...this.targets].map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry))
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  statusCache.value = new Map()
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})
afterEach(() => {
  document.body.replaceChildren()
  activeUserKey.value = null
  users.value = new Map()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('<caribou-timeline> — keyed list', () => {
  it('renders one card per initial status, in order, keyed by id', async () => {
    const initial = Array.from({ length: 3 }, (_, i) => mkStatus(`s${i}`))
    const tl = await mount('local', asInitial(initial, 's2'))
    const cards = listItems(tl).map((li) => li.firstElementChild as CaribouStatusCard)
    expect(cards.map((c) => c.dataset.statusId)).toEqual(['s0', 's1', 's2'])
    expect(cards.map((c) => c.status)).toEqual(initial)
    expect(cards[0]!.shadowRoot!.textContent).toContain('s0')
  })

  it('keeps surviving card identity across applyNewPosts prepend', async () => {
    const initial = Array.from({ length: 10 }, (_, i) => mkStatus(`s${i}`))
    const tl = await mount('home', asInitial(initial))
    const beforeRefs = listItems(tl)
    expect(beforeRefs).toHaveLength(10)

    storeOf(tl)._testOnlyPrepend(asStatuses([mkStatus('n0'), mkStatus('n1'), mkStatus('n2')]))
    await settle(tl)
    bannerButton(tl)!.click()
    await settle(tl)

    const afterRefs = listItems(tl)
    expect(afterRefs).toHaveLength(13)
    expect(afterRefs.slice(0, 3).map((li) => (li.firstElementChild as HTMLElement).dataset.statusId))
      .toEqual(['n0', 'n1', 'n2'])
    // The original 10 now occupy positions 3..12 with identity preserved.
    for (let i = 0; i < 10; i++) {
      expect(afterRefs[i + 3]).toBe(beforeRefs[i])
    }
  })

  it('keeps card-internal <img> identity across applyNewPosts prepend', async () => {
    const initial = [mkStatus('s0'), mkStatus('s1')]
    initial[0]!.account = { ...ACCT, avatar: 'https://example.test/a.png', avatarStatic: 'https://example.test/a.png' }
    const tl = await mount('home', asInitial(initial))

    const firstLi = listItems(tl)[0]!
    const beforeImg = (firstLi.firstElementChild as HTMLElement).shadowRoot!.querySelector('img')!

    storeOf(tl)._testOnlyPrepend(asStatuses([mkStatus('n0')]))
    await settle(tl)
    bannerButton(tl)!.click()
    await settle(tl)

    // s0 moved from index 0 to index 1: same <li>, same <img> — a new node
    // would flicker the avatar and fetch it again.
    const survivor = listItems(tl)[1]!
    expect(survivor).toBe(firstLi)
    expect((survivor.firstElementChild as HTMLElement).shadowRoot!.querySelector('img')).toBe(beforeImg)
  })

  it('preserves scrollTop across applyNewPosts prepend', async () => {
    const container = document.createElement('div')
    container.style.height = '400px'
    container.style.overflow = 'auto'
    document.body.appendChild(container)

    const initial = Array.from({ length: 50 }, (_, i) => mkStatus(`s${i}`))
    const tl = await mount('home', asInitial(initial), container)

    container.scrollTop = 800
    expect(container.scrollTop).toBe(800)

    storeOf(tl)._testOnlyPrepend(asStatuses([mkStatus('n0'), mkStatus('n1'), mkStatus('n2')]))
    await settle(tl)
    bannerButton(tl)!.click()
    await settle(tl)

    expect(listItems(tl)).toHaveLength(53)
    expect(container.scrollTop).toBe(800)
  })
})

describe('<caribou-timeline> — polling stays cheap', () => {
  // Two ways a card can be touched. `setter`: the parent wrote `.status`.
  // Lit writes an object binding on every parent render, and the card drops
  // the write when the reference is unchanged — so the number that matters
  // is `render`: the card did work and may have replaced its DOM.
  function watchCards() {
    const proto = CaribouStatusCard.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'status')!
    const counts = { setter: 0, render: 0 }
    Object.defineProperty(proto, 'status', {
      ...descriptor,
      set(this: unknown, v: unknown) {
        counts.setter++
        descriptor.set!.call(this, v)
      },
    })
    const render = proto.render
    proto.render = function (this: CaribouStatusCard) {
      counts.render++
      return render.call(this)
    }
    return {
      counts,
      restore() {
        Object.defineProperty(proto, 'status', descriptor)
        proto.render = render
      },
    }
  }

  it('does not touch any card on a poll that finds nothing', async () => {
    const tl = await mount('home', asInitial(Array.from({ length: 5 }, (_, i) => mkStatus(`s${i}`))))
    const timelineRender = vi.spyOn(tl, 'render')
    const watch = watchCards()
    try {
      // No client → the poll resolves empty and no signal changes.
      await storeOf(tl).poll()
      await settle(tl)
      expect(watch.counts).toEqual({ setter: 0, render: 0 })
      expect(timelineRender).not.toHaveBeenCalled()
    } finally {
      watch.restore()
    }
  })

  it('does not touch any card when a poll only buffers new posts', async () => {
    const tl = await mount('home', asInitial(Array.from({ length: 5 }, (_, i) => mkStatus(`s${i}`))))
    const before = listItems(tl)
    const watch = watchCards()
    try {
      // Same store writes a poll makes when it finds posts: the global
      // status cache gets a new Map and the new-posts buffer grows.
      storeOf(tl)._testOnlyPrepend(asStatuses([mkStatus('n0'), mkStatus('n1')]))
      await settle(tl)

      expect(bannerButton(tl)?.textContent?.trim()).toBe('2 new posts')
      expect(watch.counts.render).toBe(0)
      const after = listItems(tl)
      expect(after).toHaveLength(5)
      after.forEach((li, i) => expect(li).toBe(before[i]))
    } finally {
      watch.restore()
    }
  })

  it('does not touch any card when the cache changes for a status it does not show', async () => {
    const tl = await mount('home', asInitial(Array.from({ length: 3 }, (_, i) => mkStatus(`s${i}`))))
    const timelineRender = vi.spyOn(tl, 'render')
    const watch = watchCards()
    try {
      const next = new Map(statusCache.value)
      next.set('elsewhere', mkStatus('elsewhere') as unknown as Parameters<typeof next.set>[1])
      statusCache.value = next
      await settle(tl)
      expect(watch.counts).toEqual({ setter: 0, render: 0 })
      expect(timelineRender).not.toHaveBeenCalled()
    } finally {
      watch.restore()
    }
  })

  it('renders only the card whose status object changed', async () => {
    const tl = await mount('home', asInitial(Array.from({ length: 3 }, (_, i) => mkStatus(`s${i}`))))
    const cards = listItems(tl).map((li) => li.firstElementChild as CaribouStatusCard)
    const watch = watchCards()
    try {
      const edited = { ...mkStatus('s1'), content: '<p>edited</p>' }
      const next = new Map(statusCache.value)
      next.set('s1', edited as unknown as Parameters<typeof next.set>[1])
      statusCache.value = next
      await settle(tl)
      expect(watch.counts.render).toBe(1)
      expect(cards[1]!.shadowRoot!.textContent).toContain('edited')
      expect(listItems(tl).map((li) => li.firstElementChild)).toEqual(cards)
    } finally {
      watch.restore()
    }
  })

  it('polls only for the home timeline, and stops when disconnected', async () => {
    const home = await mount('home', asInitial([mkStatus('s0')]))
    const local = await mount('local', asInitial([mkStatus('s1')], 's1'))
    const homePoll = vi.spyOn(storeOf(home), 'poll')
    const localPoll = vi.spyOn(storeOf(local), 'poll')

    // The poller runs at once when the tab becomes visible.
    document.dispatchEvent(new Event('visibilitychange'))
    expect(homePoll).toHaveBeenCalledTimes(1)
    expect(localPoll).not.toHaveBeenCalled()

    home.remove()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(homePoll).toHaveBeenCalledTimes(1)
  })
})

describe('<caribou-timeline> — new-posts banner', () => {
  it('shows nothing until the store has buffered posts', async () => {
    const tl = await mount('home', asInitial([mkStatus('s0')]))
    expect(bannerButton(tl)).toBeNull()
  })

  it('shows the count, and a click moves the buffered posts into the list', async () => {
    const tl = await mount('home', asInitial([mkStatus('s0')]))
    storeOf(tl)._testOnlyPrepend(asStatuses([mkStatus('n0')]))
    await settle(tl)
    expect(bannerButton(tl)!.textContent!.trim()).toBe('1 new post')
    // The list stays as it was while the banner shows.
    expect(listItems(tl)).toHaveLength(1)

    bannerButton(tl)!.click()
    await settle(tl)
    expect(listItems(tl).map((li) => (li.firstElementChild as HTMLElement).dataset.statusId))
      .toEqual(['n0', 's0'])
    expect(bannerButton(tl)).toBeNull()
  })

  it('applies new posts for an apply-new-posts event from the banner', async () => {
    const tl = await mount('home', asInitial([mkStatus('s0')]))
    storeOf(tl)._testOnlyPrepend(asStatuses([mkStatus('n0')]))
    await settle(tl)
    banner(tl).dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true, composed: true }))
    await settle(tl)
    expect(listItems(tl)).toHaveLength(2)
  })
})

describe('<caribou-timeline> — states', () => {
  it('seeds from initial without a fetch', async () => {
    const tl = document.createElement('caribou-timeline') as CaribouTimeline
    tl.kind = 'local'
    tl.initial = asInitial([mkStatus('s0')], 's0')
    document.body.appendChild(tl)
    // First render already has the card: no loading or empty flash.
    await tl.updateComplete
    expect(listItems(tl)).toHaveLength(1)
    expect(tl.shadowRoot!.textContent).not.toContain('Loading your timeline')
    expect(tl.shadowRoot!.textContent).not.toContain('No posts yet')
  })

  it('shows the loading notice on the first render when it has to fetch', async () => {
    const tl = document.createElement('caribou-timeline') as CaribouTimeline
    tl.kind = 'home'
    document.body.appendChild(tl)
    await tl.updateComplete
    expect(tl.shadowRoot!.textContent).toContain('Loading your timeline…')
    // No client → the load resolves empty.
    await new Promise((r) => setTimeout(r, 0))
    await settle(tl)
    expect(tl.shadowRoot!.textContent).toContain('No posts yet.')
  })

  it('shows the empty notice for an empty initial page', async () => {
    const tl = await mount('local', asInitial([]))
    expect(tl.shadowRoot!.textContent).toContain('No posts yet.')
    expect(tl.shadowRoot!.querySelector('ul')).toBeNull()
    expect(sentinel(tl)).toBeNull()
  })

  it('shows the store error as an alert in place of the list', async () => {
    const tl = await mount('home', asInitial([mkStatus('s0')]))
    ;(storeOf(tl).error as Writable<unknown>).value = { message: 'upstream 503' }
    await settle(tl)
    const alert = tl.shadowRoot!.querySelector('[role="alert"]')!
    expect(alert.textContent!.trim()).toBe('upstream 503')
    expect(tl.shadowRoot!.querySelector('ul')).toBeNull()
  })

  it('reflects kind to an attribute', async () => {
    const tl = await mount('public', asInitial([]))
    expect(tl.getAttribute('kind')).toBe('public')
  })
})

describe('<caribou-timeline> — older posts', () => {
  it('renders a query-only ?max_id= link to the page after the last status', async () => {
    const tl = await mount('local', asInitial([mkStatus('s0'), mkStatus('s1')], 's1'))
    const a = sentinel(tl)!
    expect(a.getAttribute('href')).toBe('?max_id=s1')
    expect(a.getAttribute('rel')).toBe('next')
    expect(a.textContent!.trim()).toBe('Older posts →')
  })

  it('renders no link when the server said there is no next page', async () => {
    const tl = await mount('local', asInitial([mkStatus('s0')], null))
    expect(sentinel(tl)).toBeNull()
  })

  describe('signed in: the link pages in place', () => {
    beforeEach(() => { signIn() })

    it('swallows the click so the browser does not leave the page', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0')], 's0'))
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      sentinel(tl)!.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(true)
    })

    it('loads the next page when the link scrolls into view', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0')], 's0'))
      const io = FakeIntersectionObserver.instances.at(-1)!
      expect([...io.targets]).toEqual([sentinel(tl)])
      const loadMore = vi.spyOn(storeOf(tl), 'loadMore').mockResolvedValue()

      io.fire(false)
      expect(loadMore).not.toHaveBeenCalled()
      io.fire(true)
      expect(loadMore).toHaveBeenCalledTimes(1)
    })

    it('removes the link and stops observing when the timeline ends', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0')], 's0'))
      const io = FakeIntersectionObserver.instances.at(-1)!
      const store = storeOf(tl)
      // What the store does when the next page comes back empty.
      vi.spyOn(store, 'loadMore').mockImplementation(async () => {
        (store.hasMore as Writable<boolean>).value = false
      })
      io.fire(true)
      await new Promise((r) => setTimeout(r, 0))
      await settle(tl)
      expect(sentinel(tl)).toBeNull()
      expect(io.targets.size).toBe(0)
      expect(listItems(tl)).toHaveLength(1)
    })

    it('observes the link again after a page loads, so a short page keeps loading', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0')], 's0'))
      const io = FakeIntersectionObserver.instances.at(-1)!
      const link = sentinel(tl)!
      const store = storeOf(tl)
      vi.spyOn(store, 'loadMore').mockImplementation(async () => {
        store._testOnlyPrepend(asStatuses([mkStatus('older')]))
        store.applyNewPosts()
      })
      expect(io.observeCalls).toBe(1)

      io.fire(true)
      await new Promise((r) => setTimeout(r, 0))
      await settle(tl)

      expect(sentinel(tl)).toBe(link)
      expect(io.observeCalls).toBe(2)
      expect([...io.targets]).toEqual([link])
    })

    it('stops observing when disconnected', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0')], 's0'))
      const io = FakeIntersectionObserver.instances.at(-1)!
      tl.remove()
      expect(io.targets.size).toBe(0)
    })

    it('hands the link back to the browser when the user signs out', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0')], 's0'))
      const io = FakeIntersectionObserver.instances.at(-1)!
      activeUserKey.value = null
      await settle(tl)
      expect(io.targets.size).toBe(0)
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      sentinel(tl)!.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(false)
    })
  })

  // Browsing /local or /public with the instance cookie only. The store has
  // no client, so in-place paging would fetch nothing, read that as the end
  // of the timeline, and remove the link. It must stay a real link to the
  // next server-rendered page.
  describe('no signed-in client: the link stays a plain link', () => {
    it('does not watch the link for scrolling', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0')], 's0'))
      expect(sentinel(tl)).not.toBeNull()
      const observed = FakeIntersectionObserver.instances.flatMap((io) => [...io.targets])
      expect(observed).toEqual([])
    })

    it('lets the browser follow the click', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0')], 's0'))
      const loadMore = vi.spyOn(storeOf(tl), 'loadMore')
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      sentinel(tl)!.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(false)
      expect(loadMore).not.toHaveBeenCalled()
    })

    it('keeps the link after the page settles', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0'), mkStatus('s1')], 's1'))
      await new Promise((r) => setTimeout(r, 0))
      await settle(tl)
      expect(sentinel(tl)!.getAttribute('href')).toBe('?max_id=s1')
    })

    it('starts paging in place once a user is signed in', async () => {
      const tl = await mount('local', asInitial([mkStatus('s0')], 's0'))
      signIn()
      await settle(tl)
      const io = FakeIntersectionObserver.instances.at(-1)!
      expect([...io.targets]).toEqual([sentinel(tl)])
    })
  })
})
