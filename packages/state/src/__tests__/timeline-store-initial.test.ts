import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import { statusCache } from '../caches.js'
import { createTimelineStore } from '../timeline-store.js'

const FIXTURE: Status[] = [
  { id: '110', content: 'a', account: { id: '1' } } as unknown as Status,
  { id: '109', content: 'b', account: { id: '1' } } as unknown as Status,
]

beforeEach(() => {
  statusCache.value = new Map()
})

describe('createTimelineStore({ initial })', () => {
  it('seeds statuses + nextCursor without calling fetchTimeline', async () => {
    const fetchTimeline = vi.fn()
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextCursor: '108' },
    })
    expect(store.statuses.value.map((s) => s.id)).toEqual(['110', '109'])
    expect(store.loading.value).toBe(false)
    expect(fetchTimeline).not.toHaveBeenCalled()

    await store.load()
    expect(fetchTimeline).not.toHaveBeenCalled()
  })

  it('uses nextCursor for the next loadMore() call', async () => {
    const fetchTimeline = vi.fn(async () => [])
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextCursor: '108' },
    })
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenCalledWith('local', { cursor: '108' })
  })

  it('uses the cursor of the appended page on the next loadMore()', async () => {
    let calls = 0
    const fetchTimeline = vi.fn(async () => {
      calls++
      return calls === 1
        ? Object.assign([{ id: '107', content: 'c', account: { id: '1' } }] as unknown as Status[], { nextCursor: '107' })
        : Object.assign([] as Status[], { nextCursor: null })
    })
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextCursor: '108' },
    })
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenLastCalledWith('local', { cursor: '108' })
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenLastCalledWith('local', { cursor: '107' })
  })

  it('hasMore is false when initial.nextCursor is null', () => {
    const fetchTimeline = vi.fn()
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextCursor: null },
    })
    expect(store.hasMore.value).toBe(false)
  })
})
