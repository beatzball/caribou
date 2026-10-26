import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import { statusCache } from '../caches.js'
import { createTimelineStore } from '../timeline-store.js'
import { activeUserKey } from '../users.js'

function makeStatus(id: string): mastodon.v1.Status {
  return { id, content: `<p>${id}</p>`, account: { id: 'a1' } } as unknown as mastodon.v1.Status
}

type FetchImpl = CaribouClient['fetchTimeline']

interface FakeClient extends CaribouClient {
  fetchTimeline: ReturnType<typeof vi.fn<FetchImpl>>
}

function fakeClient(impl?: FetchImpl): FakeClient {
  const unused = () => Promise.reject(new Error('not used in timeline-store tests'))
  return {
    userKey: toUserKey('beatzball', 'fosstodon.org'),
    fetchTimeline: vi.fn<FetchImpl>(impl ?? (async () => [])),
    fetchStatus: unused as CaribouClient['fetchStatus'],
    fetchThread: unused as CaribouClient['fetchThread'],
    lookupAccount: unused as CaribouClient['lookupAccount'],
    verifyCredentials: unused as CaribouClient['verifyCredentials'],
    fetchAccountStatuses: unused as CaribouClient['fetchAccountStatuses'],
    favourite: unused as CaribouClient['favourite'],
    unfavourite: unused as CaribouClient['unfavourite'],
    reblog: unused as CaribouClient['reblog'],
    unreblog: unused as CaribouClient['unreblog'],
    bookmark: unused as CaribouClient['bookmark'],
    unbookmark: unused as CaribouClient['unbookmark'],
    fetchRelationships: unused as CaribouClient['fetchRelationships'],
    follow: unused as CaribouClient['follow'],
    unfollow: unused as CaribouClient['unfollow'],
    createStatus: unused as CaribouClient['createStatus'],
    uploadMedia: unused as CaribouClient['uploadMedia'],
    fetchMedia: unused as CaribouClient['fetchMedia'],
    waitForMedia: unused as CaribouClient['waitForMedia'],
    updateMedia: unused as CaribouClient['updateMedia'],
    fetchInstance: unused as CaribouClient['fetchInstance'],
    fetchNotifications: unused as CaribouClient['fetchNotifications'],
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

  it('_testOnlyPrepend injects statuses into the new-posts buffer', () => {
    const client = fakeClient()
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    store._testOnlyPrepend([makeStatus('x'), makeStatus('y')])
    expect(store.newPostsCount.value).toBe(2)
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['x', 'y'])
  })
})

describe('createTimelineStore — revisit', () => {
  it('refresh() puts newer posts in the buffer and leaves the list alone', async () => {
    const client = fakeClient(async (_kind, params) =>
      params?.sinceId ? [makeStatus('c')] : [makeStatus('b'), makeStatus('a')])
    const store = createTimelineStore('home', { clientSource: () => client })
    await store.load()
    await store.refresh()
    expect(client.fetchTimeline).toHaveBeenLastCalledWith('home', { sinceId: 'b' })
    expect(store.statusIds.value).toEqual(['b', 'a'])
    expect(store.newPostsCount.value).toBe(1)
    expect(store.refreshing.value).toBe(false)
  })

  it('refresh() asks from the top of the buffer when it already holds posts', async () => {
    const client = fakeClient(async () => [])
    const store = createTimelineStore('home', {
      clientSource: () => client, initial: { statuses: [makeStatus('a')], nextMaxId: null },
    })
    store._testOnlyPrepend([makeStatus('b')])
    await store.refresh()
    expect(client.fetchTimeline).toHaveBeenCalledWith('home', { sinceId: 'b' })
  })

  it('refresh() loads an empty store', async () => {
    const client = fakeClient(async () => [makeStatus('a')])
    const store = createTimelineStore('home', { clientSource: () => client })
    await store.refresh()
    expect(store.statusIds.value).toEqual(['a'])
  })

  it('offer() buffers only the posts above the newest known one', () => {
    const store = createTimelineStore('local', {
      clientSource: () => null,
      initial: { statuses: [makeStatus('b'), makeStatus('a')], nextMaxId: 'a' },
    })
    store.offer([makeStatus('d'), makeStatus('c'), makeStatus('b'), makeStatus('a')])
    expect(store.statusIds.value).toEqual(['b', 'a'])
    expect(store.newPosts.value.map((s) => s.id)).toEqual(['d', 'c'])
    store.offer([makeStatus('d'), makeStatus('c')])
    expect(store.newPostsCount.value).toBe(2)
  })

  it('offer() takes edits and counts but keeps the reader flags', () => {
    const store = createTimelineStore('local', {
      clientSource: () => null,
      initial: { statuses: [{ ...makeStatus('a'), favourited: true, favouritesCount: 1 }], nextMaxId: null },
    })
    store.offer([{ ...makeStatus('a'), content: '<p>edited</p>', favourited: false, favouritesCount: 4 }])
    const a = statusCache.value.get('a')!
    expect([a.content, a.favouritesCount, a.favourited]).toEqual(['<p>edited</p>', 4, true])
  })

  it('a failed refresh keeps the list, and the next one that works clears the error', async () => {
    let fail = true
    const client = fakeClient(async () => {
      if (fail) throw new Error('offline')
      return []
    })
    const store = createTimelineStore('home', {
      clientSource: () => client, initial: { statuses: [makeStatus('a')], nextMaxId: null },
    })
    await store.refresh()
    expect(store.error.value?.message).toBe('offline')
    expect(store.statusIds.value).toEqual(['a'])
    fail = false
    await store.refresh()
    expect(store.error.value).toBeNull()
  })

  it('drops a response that arrives after the active account changed', async () => {
    let resolve!: (xs: mastodon.v1.Status[]) => void
    const client = fakeClient(() => new Promise((r) => { resolve = r }))
    const store = createTimelineStore('home', {
      clientSource: () => client, initial: { statuses: [makeStatus('a')], nextMaxId: null },
    })
    const running = store.refresh()
    activeUserKey.value = toUserKey('bob', 'example.social')
    resolve([makeStatus('b')])
    await running
    activeUserKey.value = null
    expect(store.newPostsCount.value).toBe(0)
  })
})
