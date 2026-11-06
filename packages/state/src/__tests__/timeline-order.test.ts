import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MASTODON_CAPABILITIES,
  type CaribouClient, type Status, type TimelineOrder, type TimelinePage,
} from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import { statusCache } from '../caches.js'
import { createTimelineStore } from '../timeline-store.js'

// The store takes its order from the client (seam 6). A feed whose ids are
// not Mastodon ids, like AT URIs, must keep the order the feed sent: sorted
// as text they would come out by author.

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

beforeEach(() => {
  statusCache.value = new Map()
})

describe('timeline order from the client', () => {
  it('keeps feed order across many authors, an old repost and two overlapping polls', async () => {
    const top = uri('zzz', '3k0')
    const { c, timelineOrder } = client(null, [
      [makeStatus(top)],
      // First poll: many authors, newest first in the feed.
      [makeStatus(uri('mmm', '3k5')), makeStatus(uri('aaa', '3k4')), makeStatus(uri('qqq', '3k3'))],
      // Second poll overlaps the first, and a repost wrapper of an old post
      // sits on top.
      [makeStatus('repost:did:plc:bbb:' + uri('ccc', '2a0')), makeStatus(uri('yyy', '3k6')),
        makeStatus(uri('mmm', '3k5')), makeStatus(uri('aaa', '3k4'))],
    ])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    await store.poll()
    expect(store.newPosts.value.map((s) => s.id)).toEqual([
      'repost:did:plc:bbb:' + uri('ccc', '2a0'),
      uri('yyy', '3k6'),
      uri('mmm', '3k5'),
      uri('aaa', '3k4'),
      uri('qqq', '3k3'),
    ])
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

  // A page can land after a newer one: page data offered late, or two
  // checks in flight at once. Arrival order says nothing about which page
  // is fresher, so a post already buffered or shown keeps its place, and
  // only new posts go in, next to their neighbors in the incoming page.
  it('a late, older, overlapping page does not move buffered posts', async () => {
    const { c } = client(null, [[makeStatus('A')], [makeStatus('C'), makeStatus('B')]])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['C', 'B'])
    store.offer([makeStatus('B'), makeStatus('A')])
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['C', 'B'])
  })

  it('a late page puts its new posts next to their neighbors in that page', async () => {
    const { c } = client(null, [[makeStatus('A')], [makeStatus('D'), makeStatus('B')]])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    // C sits between D and B in the feed; it arrives in an older page.
    store.offer([makeStatus('C'), makeStatus('B'), makeStatus('A')])
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['D', 'C', 'B'])
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['D', 'C', 'B', 'A'])
  })

  it('two overlapping checks that finish in reverse order keep feed order', async () => {
    const pages: Array<(p: Status[]) => void> = []
    const fetchTimeline = vi.fn((_k: unknown, params?: { sinceId?: string }) =>
      params?.sinceId
        ? new Promise<TimelinePage>((r) => { pages.push(r) })
        : Promise.resolve([makeStatus('A')] as TimelinePage))
    const c = {
      userKey: toUserKey('beatzball', 'fosstodon.org'),
      capabilities: MASTODON_CAPABILITIES, timelineOrder: () => null, fetchTimeline,
    } as unknown as CaribouClient
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    const older = store.poll()
    const newer = store.poll()
    // The second check sees more of the feed and lands first.
    pages[1]!([makeStatus('E'), makeStatus('D'), makeStatus('C'), makeStatus('B')])
    await newer
    // The first, stale check lands last with part of the same feed and a
    // post the newer one no longer has (deleted, say) between C and B.
    pages[0]!([makeStatus('C'), makeStatus('X'), makeStatus('B')])
    await older
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['E', 'D', 'C', 'X', 'B'])
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
