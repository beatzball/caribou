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
    const { c } = client(mastodonTimelineOrder('home'), [
      [makeStatus('100')],
      [makeStatus('101')],
      [makeStatus('103'), makeStatus('102')],
    ])
    const store = createTimelineStore('home', { clientSource: () => c, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    await store.poll()
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['103', '102', '101'])
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
