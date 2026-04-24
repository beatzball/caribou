import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import { statusCache } from '../caches.js'
import { createTimelineStore } from '../timeline-store.js'

function makeStatus(id: string): mastodon.v1.Status {
  return { id, content: `<p>${id}</p>`, account: { id: 'a1' } } as unknown as mastodon.v1.Status
}

type FetchImpl = CaribouClient['fetchTimeline']

interface FakeClient extends CaribouClient {
  fetchTimeline: ReturnType<typeof vi.fn<FetchImpl>>
}

function fakeClient(impl?: FetchImpl): FakeClient {
  return {
    userKey: toUserKey('beatzball', 'fosstodon.org'),
    fetchTimeline: vi.fn<FetchImpl>(impl ?? (async () => [])),
  }
}

beforeEach(() => {
  statusCache.value = new Map()
})

describe('createTimelineStore', () => {
  it('load() fetches, fills the cache, and sets statusIds', async () => {
    const client = fakeClient(async () => [makeStatus('a'), makeStatus('b')])
    const store = createTimelineStore('home', {
      clientSource: () => client,
      pollIntervalMs: 0,
    })
    await store.load()
    expect(store.statusIds.value).toEqual(['a', 'b'])
    expect(store.statuses.value.map((s) => s.id)).toEqual(['a', 'b'])
    expect(store.loading.value).toBe(false)
    expect(store.error.value).toBeNull()
  })

  it('loadMore() appends older statuses using maxId', async () => {
    const client = fakeClient(async (_kind, params) =>
      params?.maxId === 'b' ? [makeStatus('c'), makeStatus('d')] : [makeStatus('a'), makeStatus('b')],
    )
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    await store.loadMore()
    expect(store.statusIds.value).toEqual(['a', 'b', 'c', 'd'])
  })

  it('sets error on failure and clears loading', async () => {
    const client = fakeClient(async () => { throw Object.assign(new Error('x'), { name: 'CaribouError', code: 'server_error' }) })
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    expect(store.error.value?.code).toBe('server_error')
    expect(store.loading.value).toBe(false)
  })

  it('poll() fills the newPosts buffer using sinceId=firstId; applyNewPosts prepends', async () => {
    const calls: Array<unknown> = []
    const client = fakeClient(async (_k, params) => {
      calls.push(params)
      if (!params) return [makeStatus('b'), makeStatus('a')]
      if (params.sinceId === 'b') return [makeStatus('d'), makeStatus('c')]
      return []
    })
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    expect(store.newPostsCount.value).toBe(2)
    expect(store.statusIds.value).toEqual(['b', 'a'])
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['d', 'c', 'b', 'a'])
    expect(store.newPostsCount.value).toBe(0)
  })

  it('poll() with no firstId (empty store) does nothing', async () => {
    const client = fakeClient(async () => [])
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.poll()
    expect(client.fetchTimeline).not.toHaveBeenCalled()
  })

  it('loadMore() bails when loading is in-flight or hasMore=false', async () => {
    const client = fakeClient(async () => [])
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    expect(store.hasMore.value).toBe(false)
    await store.loadMore()
    expect(client.fetchTimeline).toHaveBeenCalledTimes(1)
  })

  it('loadMore() bails when there is no last id', async () => {
    const client = fakeClient(async () => [])
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.loadMore()
    expect(client.fetchTimeline).not.toHaveBeenCalled()
  })

  it('loadMore() captures errors on the error signal', async () => {
    let calls = 0
    const client = fakeClient(async () => {
      calls += 1
      if (calls === 1) return [makeStatus('a')]
      throw Object.assign(new Error('x'), { name: 'CaribouError', code: 'server_error' })
    })
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    await store.loadMore()
    expect(store.error.value?.code).toBe('server_error')
    expect(store.loading.value).toBe(false)
  })

  it('poll() captures errors on the error signal', async () => {
    let calls = 0
    const client = fakeClient(async () => {
      calls += 1
      if (calls === 1) return [makeStatus('a')]
      throw Object.assign(new Error('x'), { name: 'CaribouError', code: 'server_error' })
    })
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    expect(store.error.value?.code).toBe('server_error')
  })

  it('applyNewPosts() is a no-op when the buffer is empty', async () => {
    const client = fakeClient(async () => [makeStatus('a')])
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['a'])
  })

  it('newPosts exposes buffered statuses from the cache', async () => {
    const client = fakeClient(async (_k, params) => {
      if (!params) return [makeStatus('b')]
      if (params.sinceId === 'b') return [makeStatus('c')]
      return []
    })
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['c'])
  })
})
