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
// Such a feed merges a page only by a post the store already knows (seam
// 7): a check pages from the top until it meets the known top entry, so its
// page ends with that entry. A page that meets nothing is a gap.

function makeStatus(id: string): Status {
  return { id, content: `<p>${id}</p>`, account: { id: 'a1' } } as unknown as Status
}

const uri = (did: string, rkey: string) => `at://did:plc:${did}/app.bsky.feed.post/${rkey}`

function client(order: TimelineOrder, pages: Status[][]) {
  const fetchTimeline = vi.fn(async (): Promise<TimelinePage> => pages.shift() ?? [])
  const timelineOrder = vi.fn(() => order)
  const c = {
    userKey: toUserKey('beatzball', 'fosstodon.org'),
    capabilities: MASTODON_CAPABILITIES,
    timelineOrder,
    fetchTimeline,
  } as unknown as CaribouClient
  return { c, timelineOrder }
}

// A client whose checks (`sinceId` fetches) wait until the test answers.
function deferredClient(order: TimelineOrder = null, userKey = toUserKey('beatzball', 'fosstodon.org')) {
  const pending: Array<(p: Status[]) => void> = []
  const fetchTimeline = vi.fn((_k: unknown, params?: { sinceId?: string }) =>
    params?.sinceId
      ? new Promise<TimelinePage>((r) => { pending.push(r) })
      : Promise.resolve([makeStatus('A')] as TimelinePage))
  const c = {
    userKey, capabilities: MASTODON_CAPABILITIES, timelineOrder: () => order, fetchTimeline,
  } as unknown as CaribouClient
  return { c, pending, fetchTimeline }
}

const ids = (xs: Status[]) => xs.map((s) => s.id)

beforeEach(() => {
  statusCache.value = new Map()
})

describe('timeline order from the client', () => {
  it('keeps feed order across many authors, an old repost and two checks', async () => {
    const top = uri('zzz', '3k0')
    const repost = 'repost:did:plc:bbb:' + uri('ccc', '2a0')
    const { c, timelineOrder } = client(null, [
      [makeStatus(top)],
      // First check: many authors, newest first, down to the known top.
      [uri('mmm', '3k5'), uri('aaa', '3k4'), uri('qqq', '3k3'), top].map(makeStatus),
      // Second check overlaps the first; a repost of an old post is on top.
      [repost, uri('yyy', '3k6'), uri('mmm', '3k5'), uri('aaa', '3k4')].map(makeStatus),
    ])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    await store.poll()
    expect(ids(store.newPosts.value)).toEqual([
      repost, uri('yyy', '3k6'), uri('mmm', '3k5'), uri('aaa', '3k4'), uri('qqq', '3k3'),
    ])
    expect(store.gap.value).toBe(false)
    expect(timelineOrder).toHaveBeenCalledWith('home')
    store.applyNewPosts()
    expect(store.statusIds.value).toHaveLength(6)
    expect(store.statusIds.value.at(-1)).toBe(top)
  })

  it('sorts the buffer with the compare function the client gives', async () => {
    // Oldest first by letter: neither Mastodon's order nor the order the
    // pages came in, so the test fails if the comparator is not used.
    const oldestFirst = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    const { c } = client(oldestFirst, [
      [makeStatus('top')],
      [makeStatus('m'), makeStatus('z')],
      [makeStatus('b'), makeStatus('y')],
    ])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    await store.poll()
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['b', 'm', 'y', 'z'])
  })

  // A page can land after a newer one: page data offered late, or a check
  // that finishes after page data. Arrival order says nothing about which
  // page is fresher, so a post already buffered or shown keeps its place,
  // and only new posts go in, next to their neighbors in the page.
  it('a late, older, overlapping page does not move buffered posts', async () => {
    const { c } = client(null, [[makeStatus('A')], ['C', 'B', 'A'].map(makeStatus)])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    expect(ids(store.newPosts.value)).toEqual(['C', 'B'])
    store.offer(['B', 'A'].map(makeStatus))
    expect(ids(store.newPosts.value)).toEqual(['C', 'B'])
  })

  it('a late page puts its new posts next to their neighbors in that page', async () => {
    const { c } = client(null, [[makeStatus('A')], ['D', 'B', 'A'].map(makeStatus)])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    // C sits between D and B in the feed; it arrives in an older page.
    store.offer(['C', 'B', 'A'].map(makeStatus))
    expect(ids(store.newPosts.value)).toEqual(['D', 'C', 'B'])
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['D', 'C', 'B', 'A'])
  })

  it('a check while one is in flight joins it: one request', async () => {
    const { c, pending, fetchTimeline } = deferredClient()
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    const first = store.poll()
    const second = store.poll()
    expect(second).toBe(first)
    expect(fetchTimeline).toHaveBeenCalledTimes(2) // the load and one check
    pending[0]!(['C', 'B', 'A'].map(makeStatus))
    await first
    expect(pending).toHaveLength(1)
    expect(ids(store.newPosts.value)).toEqual(['C', 'B'])
    // The next check after it asks again, from the buffer's top.
    const third = store.poll()
    expect(fetchTimeline).toHaveBeenLastCalledWith('home', { sinceId: 'C' })
    pending[1]!(['D', 'C'].map(makeStatus))
    await third
    expect(ids(store.newPosts.value)).toEqual(['D', 'C', 'B'])
  })

  // The review's sequence: a check asks, page data with newer posts lands,
  // and the older check's page shares no post with either. Whichever lands
  // first, B never goes above D and C.
  for (const first of ['offer', 'check'] as const) {
    it(`a check and page data with no shared post never reorder (${first} lands first)`, async () => {
      const { c, pending } = deferredClient()
      const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
      await store.load()
      const check = store.poll()
      if (first === 'offer') store.offer(['D', 'C'].map(makeStatus))
      pending[0]!([makeStatus('B')])
      await check
      if (first === 'check') store.offer(['D', 'C'].map(makeStatus))
      // Neither page met a known post: both are gaps, and the newer
      // request (the page data, stamped when it arrives) is kept.
      expect(ids(store.newPosts.value)).toEqual([])
      expect(store.gap.value).toBe(true)
      store.applyNewPosts()
      expect(store.statusIds.value).toEqual(['D', 'C'])
      expect(store.gap.value).toBe(false)
    })
  }

  it('an anchored page merges but does not clear a newer gap', async () => {
    const { c, pending } = deferredClient()
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    const check = store.poll()
    store.offer(['D', 'C'].map(makeStatus))
    pending[0]!(['B', 'A'].map(makeStatus))
    await check
    expect(ids(store.newPosts.value)).toEqual(['B'])
    expect(store.gap.value).toBe(true)
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['D', 'C'])
    expect(ids(store.newPosts.value)).toEqual([])
  })

  it('of two gap pages, the one whose request started last is kept', async () => {
    const { c, pending } = deferredClient()
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    // An older gap first, then a newer one: the newer replaces it.
    const one = store.poll()
    pending[0]!([makeStatus('X')])
    await one
    const two = store.poll()
    pending[1]!([makeStatus('Y')])
    await two
    // A gap from a request that started before the newest one is ignored.
    const three = store.poll()
    store.offer([makeStatus('Z')])
    pending[2]!([makeStatus('W')])
    await three
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['Z'])
  })

  it('applying a gap replaces the list and pages on from the gap page', async () => {
    const { c, pending, fetchTimeline } = deferredClient()
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    store.offer(['D', 'C'].map(makeStatus), 'cursor-after-C')
    expect(store.gap.value).toBe(true)
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['D', 'C'])
    expect(store.hasMore.value).toBe(true)
    fetchTimeline.mockResolvedValueOnce([makeStatus('B')] as TimelinePage)
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenLastCalledWith('home', { maxId: 'cursor-after-C' })
    expect(store.statusIds.value).toEqual(['D', 'C', 'B'])
    expect(pending).toHaveLength(0)
  })

  it('loading the list again clears a gap', async () => {
    const { c } = deferredClient()
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    store.offer([makeStatus('Q')])
    expect(store.gap.value).toBe(true)
    await store.load()
    expect(store.gap.value).toBe(false)
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['A'])
  })

  it('a sorted timeline never has a gap', async () => {
    const { c } = deferredClient(mastodonTimelineOrder('home'))
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    store.offer(['9', '8'].map(makeStatus))
    expect(store.gap.value).toBe(false)
    expect(ids(store.newPosts.value)).toEqual(['9', '8'])
  })

  it('drops a check that lands after the list was loaded again', async () => {
    const { c, pending } = deferredClient()
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    const check = store.poll()
    await store.load()
    pending[0]!(['B', 'A'].map(makeStatus))
    await check
    expect(ids(store.newPosts.value)).toEqual([])
    expect(store.statusIds.value).toEqual(['A'])
  })

  it('drops a check that lands after the client changed', async () => {
    const one = deferredClient()
    const two = deferredClient(null, toUserKey('bob', 'example.social'))
    let current = one.c
    const store = createTimelineStore('home', { clientSource: () => current, pollIntervalMs: 0 })
    await store.load()
    const check = store.poll()
    current = two.c
    one.pending[0]!(['B', 'A'].map(makeStatus))
    await check
    expect(ids(store.newPosts.value)).toEqual([])
  })

  it('asks the client for the order of its own timeline kind', async () => {
    const { c, timelineOrder } = client(null, [[makeStatus('1')], [makeStatus('2')]])
    const kind = { type: 'list' as const, id: 'L1' }
    const store = createTimelineStore(kind, { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    expect(timelineOrder).toHaveBeenCalledWith(kind)
  })

  it('without a client, sorts as Mastodon does (signed-out pages read Mastodon)', () => {
    const store = createTimelineStore('local', { clientSource: () => null, pollIntervalMs: 0 })
    store.offer([makeStatus('1')])
    store.offer([makeStatus('3'), makeStatus('2'), makeStatus('1')])
    store.offer([makeStatus('4'), makeStatus('1')])
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['4', '3', '2'])
  })
})
