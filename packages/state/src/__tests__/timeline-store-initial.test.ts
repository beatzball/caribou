import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { statusCache } from '../caches.js'
import { createTimelineStore } from '../timeline-store.js'

const FIXTURE: mastodon.v1.Status[] = [
  { id: '110', content: 'a', account: { id: '1' } } as unknown as mastodon.v1.Status,
  { id: '109', content: 'b', account: { id: '1' } } as unknown as mastodon.v1.Status,
]

beforeEach(() => {
  statusCache.value = new Map()
})

describe('createTimelineStore({ initial })', () => {
  it('seeds statuses + nextMaxId without calling fetchTimeline', async () => {
    const fetchTimeline = vi.fn()
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextMaxId: '108' },
    })
    expect(store.statuses.value.map((s) => s.id)).toEqual(['110', '109'])
    expect(store.loading.value).toBe(false)
    expect(fetchTimeline).not.toHaveBeenCalled()

    await store.load()
    expect(fetchTimeline).not.toHaveBeenCalled()
  })

  it('uses nextMaxId for the next loadMore() call', async () => {
    const fetchTimeline = vi.fn(async () => [])
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextMaxId: '108' },
    })
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenCalledWith('local', { maxId: '108' })
  })

  it('falls back to last-id anchor on subsequent loadMore() after first append', async () => {
    let calls = 0
    const fetchTimeline = vi.fn(async () => {
      calls++
      return calls === 1
        ? ([{ id: '107', content: 'c', account: { id: '1' } }] as unknown as mastodon.v1.Status[])
        : ([] as mastodon.v1.Status[])
    })
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextMaxId: '108' },
    })
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenLastCalledWith('local', { maxId: '108' })
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenLastCalledWith('local', { maxId: '107' })
  })

  it('hasMore is false when initial.nextMaxId is null', () => {
    const fetchTimeline = vi.fn()
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextMaxId: null },
    })
    expect(store.hasMore.value).toBe(false)
  })
})
