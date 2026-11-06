import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MASTODON_CAPABILITIES, mastodonTimelineOrder,
  type CaribouClient, type Status, type TimelineOrder, type TimelinePage,
} from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import { statusCache } from '../caches.js'
import { createTimelineStore } from '../timeline-store.js'

// The store takes its order from the client (seam 6). A feed whose ids are
// not Mastodon ids, like AT URIs, must keep the order the feed sent: sorted
// as text they would come out by author.
//
// In feed order there is one source and one answer (seam 7): each check
// asks from the top post the list shows and pages down until it meets it,
// so its answer is every new entry, and it replaces the last answer. An
// answer that never meets the top shown post is a gap.

function makeStatus(id: string): Status {
  return { id, content: `<p>${id}</p>`, account: { id: 'a1' } } as unknown as Status
}

function page(ids: string[], nextCursor: string | null = null): TimelinePage {
  return Object.assign(ids.map(makeStatus), { nextCursor })
}

const uri = (did: string, rkey: string) => `at://did:plc:${did}/app.bsky.feed.post/${rkey}`
const ids = (xs: Status[]) => xs.map((s) => s.id)

function client(order: TimelineOrder, pages: TimelinePage[]) {
  const fetchTimeline = vi.fn(async (): Promise<TimelinePage> => pages.shift() ?? page([]))
  const timelineOrder = vi.fn(() => order)
  const c = {
    userKey: toUserKey('beatzball', 'fosstodon.org'),
    capabilities: MASTODON_CAPABILITIES,
    timelineOrder,
    fetchTimeline,
  } as unknown as CaribouClient
  return { c, timelineOrder, fetchTimeline }
}

// A client whose checks (`sinceId` fetches) and older pages (`cursor`
// fetches) wait until the test answers. The first load answers `[A]`.
function deferredClient(order: TimelineOrder = null, userKey = toUserKey('beatzball', 'fosstodon.org')) {
  const pending: Array<(p: TimelinePage) => void> = []
  const older: Array<(p: TimelinePage) => void> = []
  const fetchTimeline = vi.fn((_k: unknown, params?: { sinceId?: string; cursor?: string }) =>
    params?.sinceId ? new Promise<TimelinePage>((r) => { pending.push(r) })
    : params?.cursor ? new Promise<TimelinePage>((r) => { older.push(r) })
    : Promise.resolve(page(['A'], 'after-A')))
  const c = {
    userKey, capabilities: MASTODON_CAPABILITIES, timelineOrder: () => order, fetchTimeline,
  } as unknown as CaribouClient
  return { c, pending, older, fetchTimeline }
}

async function feedStore() {
  const d = deferredClient()
  const store = createTimelineStore('home', { clientSource: () => d.c, pollIntervalMs: 0 })
  await store.load()
  // One check, answered with `answer`.
  const check = async (answer: string[], cursor: string | null = null) => {
    const run = store.poll()
    d.pending[d.pending.length - 1]!(page(answer, cursor))
    await run
  }
  return { store, check, ...d }
}

beforeEach(() => {
  statusCache.value = new Map()
})

describe('sorted timelines', () => {
  it('sorts the buffer with the compare function the client gives', async () => {
    // Oldest first by letter: neither Mastodon's order nor the order the
    // pages came in, so the test fails if the comparator is not used.
    const oldestFirst = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    const { c } = client(oldestFirst, [page(['top']), page(['m', 'z']), page(['b', 'y'])])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    await store.poll()
    expect(ids(store.newPosts.value)).toEqual(['b', 'm', 'y', 'z'])
  })

  it('a sorted timeline never has a gap and still takes page data', async () => {
    const { c } = client(mastodonTimelineOrder('home'), [page(['1'])])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    store.offer([makeStatus('9'), makeStatus('8')], null)
    expect(store.gap.value).toBe(false)
    expect(ids(store.newPosts.value)).toEqual(['9', '8'])
  })

  it('without a client, sorts as Mastodon does (signed-out pages read Mastodon)', () => {
    const store = createTimelineStore('local', { clientSource: () => null, pollIntervalMs: 0 })
    store.offer([makeStatus('1')], null)
    store.offer([makeStatus('3'), makeStatus('2'), makeStatus('1')], null)
    store.offer([makeStatus('4'), makeStatus('1')], null)
    expect(ids(store.newPosts.value)).toEqual(['4', '3', '2'])
  })

  it('asks the client for the order of its own timeline kind', async () => {
    const { c, timelineOrder } = client(null, [page(['1']), page(['2', '1'])])
    const kind = { type: 'list' as const, id: 'L1' }
    const store = createTimelineStore(kind, { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    expect(timelineOrder).toHaveBeenCalledWith(kind)
  })
})

describe('feed order', () => {
  it('keeps feed order across many authors and an old repost', async () => {
    const top = uri('zzz', '3k0')
    const repost = 'repost:did:plc:bbb:' + uri('ccc', '2a0')
    const { c } = client(null, [
      page([top]),
      page([uri('mmm', '3k5'), uri('aaa', '3k4'), uri('qqq', '3k3'), top]),
      page([repost, uri('yyy', '3k6'), uri('mmm', '3k5'), uri('aaa', '3k4'), uri('qqq', '3k3'), top]),
    ])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    await store.poll()
    expect(ids(store.newPosts.value)).toEqual([
      repost, uri('yyy', '3k6'), uri('mmm', '3k5'), uri('aaa', '3k4'), uri('qqq', '3k3'),
    ])
    expect(store.gap.value).toBe(false)
    store.applyNewPosts()
    expect(store.statusIds.value).toHaveLength(6)
    expect(store.statusIds.value.at(-1)).toBe(top)
  })

  it('each check asks from the top shown post, not the buffer top', async () => {
    const { check, fetchTimeline } = await feedStore()
    await check(['C', 'B', 'A'])
    await check(['C', 'B', 'A'])
    expect(fetchTimeline).toHaveBeenLastCalledWith('home', { sinceId: 'A' })
  })

  it('a second check replaces the first one\'s answer', async () => {
    const { store, check } = await feedStore()
    await check(['C', 'B', 'A'])
    expect(ids(store.newPosts.value)).toEqual(['C', 'B'])
    // C was deleted, D is new.
    await check(['D', 'B', 'A'])
    expect(ids(store.newPosts.value)).toEqual(['D', 'B'])
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['D', 'B', 'A'])
  })

  it('a check while one is in flight joins it: one request', async () => {
    const { store, pending, fetchTimeline } = await feedStore()
    const first = store.poll()
    const second = store.poll()
    expect(second).toBe(first)
    expect(fetchTimeline).toHaveBeenCalledTimes(2) // the load and one check
    pending[0]!(page(['C', 'B', 'A']))
    await first
    expect(pending).toHaveLength(1)
    expect(ids(store.newPosts.value)).toEqual(['C', 'B'])
  })

  it('page data into a list that has posts leaves the buffer alone', async () => {
    const { store, check } = await feedStore()
    await check(['C', 'B', 'A'])
    store.offer([makeStatus('X'), makeStatus('C'), makeStatus('A')], null)
    expect(ids(store.newPosts.value)).toEqual(['C', 'B'])
    expect(store.gap.value).toBe(false)
  })

  it('page data still seeds an empty list', () => {
    const { c } = deferredClient()
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    store.offer([makeStatus('B'), makeStatus('A')], 'after-A')
    expect(store.statusIds.value).toEqual(['B', 'A'])
    expect(store.nextCursor.value).toBe('after-A')
  })

  // The review's round-4 sequences: a gap check, then a page that would
  // join it; and a newer check, then old page data. The latest check's
  // answer wins: nothing is lost and nothing is reordered.
  it('a gap check, then page data that joins it, then a check that does', async () => {
    const { store, check } = await feedStore()
    await check(['B'])
    expect(store.gap.value).toBe(true)
    expect(ids(store.newPosts.value)).toEqual(['B'])
    store.offer(['C', 'B', 'A'].map(makeStatus), null)
    expect(ids(store.newPosts.value)).toEqual(['B'])
    await check(['C', 'B', 'A'])
    expect(store.gap.value).toBe(false)
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['C', 'B', 'A'])
  })

  it('old page data after a newer check does not replace its answer', async () => {
    const { store, check } = await feedStore()
    await check(['D', 'C'], 'after-C')
    store.offer([makeStatus('B')], null)
    expect(ids(store.newPosts.value)).toEqual(['D', 'C'])
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['D', 'C'])
  })

  it('applying a gap replaces the list and pages on from its cursor', async () => {
    const { store, check, older, fetchTimeline } = await feedStore()
    await check(['D', 'C'], 'after-C')
    expect(store.gap.value).toBe(true)
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['D', 'C'])
    expect(store.gap.value).toBe(false)
    expect(store.hasMore.value).toBe(true)
    const more = store.loadMore()
    expect(fetchTimeline).toHaveBeenLastCalledWith('home', { cursor: 'after-C' })
    older[0]!(page(['B'], null))
    await more
    expect(store.statusIds.value).toEqual(['D', 'C', 'B'])
  })

  it('an older page in flight when a gap is applied is dropped', async () => {
    const { store, check, older } = await feedStore()
    const more = store.loadMore()
    await check(['D', 'C'], 'after-C')
    store.applyNewPosts()
    older[0]!(page(['Z'], 'after-Z'))
    await more
    expect(store.statusIds.value).toEqual(['D', 'C'])
    expect(store.nextCursor.value).toBe('after-C')
  })

  it('an empty answer, or one that is only the top post, empties the buffer', async () => {
    const { store, check } = await feedStore()
    await check(['B'])
    expect(store.gap.value).toBe(true)
    await check(['A'])
    expect(ids(store.newPosts.value)).toEqual([])
    expect(store.gap.value).toBe(false)
    await check([])
    expect(store.gap.value).toBe(false)
  })

  it('loading the list again clears a gap', async () => {
    const { store, check } = await feedStore()
    await check(['Q'])
    expect(store.gap.value).toBe(true)
    await store.load()
    expect(store.gap.value).toBe(false)
  })

  it('drops a check that lands after the list was loaded again', async () => {
    const { store, pending } = await feedStore()
    const run = store.poll()
    await store.load()
    pending[0]!(page(['B', 'A']))
    await run
    expect(ids(store.newPosts.value)).toEqual([])
    expect(store.statusIds.value).toEqual(['A'])
  })

  it('drops a check that lands after the client changed', async () => {
    const one = deferredClient()
    const two = deferredClient(null, toUserKey('bob', 'example.social'))
    let current = one.c
    const store = createTimelineStore('home', { clientSource: () => current, pollIntervalMs: 0 })
    await store.load()
    const run = store.poll()
    current = two.c
    one.pending[0]!(page(['B', 'A']))
    await run
    expect(ids(store.newPosts.value)).toEqual([])
  })
})
