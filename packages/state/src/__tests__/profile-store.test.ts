import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { statusCache } from '../caches.js'
import { createProfileStore } from '../profile-store.js'

const FIXTURE: mastodon.v1.Status[] = [
  { id: '210', content: 'p1', account: { id: '42' } } as unknown as mastodon.v1.Status,
  { id: '209', content: 'p0', account: { id: '42' } } as unknown as mastodon.v1.Status,
]

beforeEach(() => {
  statusCache.value = new Map()
})

describe('createProfileStore', () => {
  it('skips load() when initial is provided', async () => {
    const fetchAccountStatuses = vi.fn()
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const store = createProfileStore('42', 'posts', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextMaxId: null },
    })
    await store.load()
    expect(fetchAccountStatuses).not.toHaveBeenCalled()
    expect(store.statuses.value.map((s) => s.id)).toEqual(['210', '209'])
  })

  it('threads tab into fetchAccountStatuses', async () => {
    const fetchAccountStatuses = vi.fn(async () => FIXTURE)
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const store = createProfileStore('42', 'media', { clientSource: () => client })
    await store.load()
    expect(fetchAccountStatuses).toHaveBeenCalledWith('42', { tab: 'media', maxId: undefined })
  })

  it('loadMore appends with maxId from last status id', async () => {
    let calls = 0
    const fetchAccountStatuses = vi.fn(async () => {
      calls++
      return calls === 1
        ? FIXTURE
        : ([{ id: '208', content: 'p-1', account: { id: '42' } }] as unknown as mastodon.v1.Status[])
    })
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const store = createProfileStore('42', 'posts', { clientSource: () => client })
    await store.load()
    await store.loadMore()
    expect(fetchAccountStatuses).toHaveBeenLastCalledWith('42', { tab: 'posts', maxId: '209' })
    expect(store.statuses.value.map((s) => s.id)).toEqual(['210', '209', '208'])
  })

  it('returns null page when client source is unavailable', async () => {
    const store = createProfileStore('42', 'posts', { clientSource: () => null })
    await store.load()
    expect(store.statuses.value).toEqual([])
    expect(store.hasMore.value).toBe(false)
  })

  it('captures fetch errors into the error signal', async () => {
    const fetchAccountStatuses = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { code: 'unknown' })
    })
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const store = createProfileStore('42', 'posts', { clientSource: () => client })
    await store.load()
    expect(store.error.value).toMatchObject({ message: 'boom' })
    expect(store.loading.value).toBe(false)
  })
})
