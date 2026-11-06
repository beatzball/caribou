import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaribouClient, Status, TimelinePage } from '@beatzball/caribou-mastodon-client'
import { statusCache } from '../caches.js'
import { createProfileStore } from '../profile-store.js'
import { createTimelineStore } from '../timeline-store.js'

// Seam 5: a page names the next one with a cursor the store never reads.
// These cursors look nothing like the post ids, the way another network's
// paging tokens do, so a store that pages by the last post id asks for
// the wrong page here.

function st(id: string): Status {
  return { id, content: `<p>${id}</p>`, account: { id: 'a1' } } as unknown as Status
}

function page(ids: string[], nextCursor: string | null): TimelinePage {
  return Object.assign(ids.map(st), { nextCursor })
}

// Three pages. The first is the one the server rendered; the client asks
// for the other two by the cursor each page named.
const PAGES: Record<string, TimelinePage> = {
  '':                 page(['at://p/3', 'at://p/2'], 'tok:2026-11-05T10'),
  'tok:2026-11-05T10': page(['at://p/1', 'at://p/0'], 'tok:2026-11-04T08'),
  'tok:2026-11-04T08': page(['at://p/-1'], null),
}

beforeEach(() => {
  statusCache.value = new Map()
})

describe('timeline store, opaque cursor', () => {
  it('pages through three pages by the cursor each page named', async () => {
    const fetchTimeline = vi.fn(async (_kind: unknown, params?: { cursor?: string }) =>
      PAGES[params?.cursor ?? '']!)
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('home', { clientSource: () => client })
    await store.load()
    expect(store.nextCursor.value).toBe('tok:2026-11-05T10')
    await store.loadMore()
    await store.loadMore()
    expect(fetchTimeline.mock.calls.map((c) => c[1])).toEqual([
      undefined, { cursor: 'tok:2026-11-05T10' }, { cursor: 'tok:2026-11-04T08' },
    ])
    expect(store.statusIds.value).toEqual(['at://p/3', 'at://p/2', 'at://p/1', 'at://p/0', 'at://p/-1'])
    expect(store.hasMore.value).toBe(false)
    expect(store.nextCursor.value).toBeNull()
    // The end: no fourth request.
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenCalledTimes(3)
  })

  it('takes the first cursor from the server page (SSR handoff)', async () => {
    const fetchTimeline = vi.fn(async (_kind: unknown, params?: { cursor?: string }) =>
      PAGES[params?.cursor ?? '']!)
    const client = { fetchTimeline } as unknown as CaribouClient
    const first = PAGES['']!
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: [...first], nextCursor: first.nextCursor },
    })
    expect(store.nextCursor.value).toBe('tok:2026-11-05T10')
    await store.load()
    await store.loadMore()
    await store.loadMore()
    expect(fetchTimeline.mock.calls.map((c) => c[1])).toEqual([
      { cursor: 'tok:2026-11-05T10' }, { cursor: 'tok:2026-11-04T08' },
    ])
    expect(store.statusIds.value).toHaveLength(5)
    expect(store.hasMore.value).toBe(false)
  })

  it('offer() into an empty list keeps the cursor it is given', async () => {
    const fetchTimeline = vi.fn(async (_kind: unknown, params?: { cursor?: string }) =>
      PAGES[params?.cursor ?? '']!)
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('public', {
      clientSource: () => client, initial: { statuses: [], nextCursor: null },
    })
    const first = PAGES['']!
    store.offer([...first], first.nextCursor)
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenLastCalledWith('public', { cursor: 'tok:2026-11-05T10' })
  })

  it('asks from the same cursor again after a failed page', async () => {
    let fail = true
    const fetchTimeline = vi.fn(async (_kind: unknown, params?: { cursor?: string }) => {
      if (params?.cursor && fail) throw new Error('offline')
      return PAGES[params?.cursor ?? '']!
    })
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('home', { clientSource: () => client })
    await store.load()
    await store.loadMore()
    fail = false
    await store.retry()
    expect(fetchTimeline.mock.calls.map((c) => c[1])).toEqual([
      undefined, { cursor: 'tok:2026-11-05T10' }, { cursor: 'tok:2026-11-05T10' },
    ])
    expect(store.statusIds.value).toHaveLength(4)
  })
})

describe('profile store, opaque cursor', () => {
  it('pages through three pages by the cursor each page named', async () => {
    const fetchAccountStatuses = vi.fn(async (_id: string, params: { cursor?: string }) =>
      PAGES[params.cursor ?? '']!)
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const store = createProfileStore('did:plc:alice', 'posts', { clientSource: () => client })
    await store.load()
    await store.loadMore()
    await store.loadMore()
    expect(fetchAccountStatuses.mock.calls.map((c) => c[1])).toEqual([
      { tab: 'posts', cursor: undefined },
      { tab: 'posts', cursor: 'tok:2026-11-05T10' },
      { tab: 'posts', cursor: 'tok:2026-11-04T08' },
    ])
    expect(store.statusIds.value).toEqual(['at://p/3', 'at://p/2', 'at://p/1', 'at://p/0', 'at://p/-1'])
    expect(store.hasMore.value).toBe(false)
    expect(store.nextCursor.value).toBeNull()
    await store.loadMore()
    expect(fetchAccountStatuses).toHaveBeenCalledTimes(3)
  })

  it('takes the first cursor from the server page (SSR handoff)', async () => {
    const fetchAccountStatuses = vi.fn(async (_id: string, params: { cursor?: string }) =>
      PAGES[params.cursor ?? '']!)
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const first = PAGES['']!
    const store = createProfileStore('did:plc:alice', 'media', {
      clientSource: () => client,
      initial: { statuses: [...first], nextCursor: first.nextCursor },
    })
    expect(store.nextCursor.value).toBe('tok:2026-11-05T10')
    expect(store.hasMore.value).toBe(true)
    await store.load()
    await store.loadMore()
    await store.loadMore()
    expect(fetchAccountStatuses.mock.calls.map((c) => c[1])).toEqual([
      { tab: 'media', cursor: 'tok:2026-11-05T10' },
      { tab: 'media', cursor: 'tok:2026-11-04T08' },
    ])
    expect(store.statusIds.value).toHaveLength(5)
    expect(store.hasMore.value).toBe(false)
  })

  it('asks from the same cursor again after a failed page', async () => {
    let fail = true
    const fetchAccountStatuses = vi.fn(async (_id: string, params: { cursor?: string }) => {
      if (params.cursor && fail) throw new Error('offline')
      return PAGES[params.cursor ?? '']!
    })
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const store = createProfileStore('did:plc:alice', 'posts', { clientSource: () => client })
    await store.load()
    await store.loadMore()
    expect(store.error.value?.message).toBe('offline')
    fail = false
    await store.loadMore()
    expect(fetchAccountStatuses.mock.calls.map((c) => c[1]?.cursor)).toEqual([
      undefined, 'tok:2026-11-05T10', 'tok:2026-11-05T10',
    ])
  })
})
