import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import { accountCache, cacheStatus, mergeStatus, statusCache } from '../caches.js'
import { _testOnlyResetMutations, toggleFavourite } from '../mutations.js'
import { createTimelineStore } from '../timeline-store.js'
import { createThreadStore } from '../thread-store.js'
import { clearKeptAlive, ownerGeneration } from '../keep-alive.js'
import { activeUserKey } from '../users.js'

// Review findings on the second round of #104. Each case failed before its fix.

type Status = mastodon.v1.Status
const st = (id: string, over: Partial<Status> = {}) => ({
  id, content: `<p>${id}</p>`, favourited: false, favouritesCount: 0,
  reblogged: false, reblogsCount: 0, bookmarked: false,
  account: { id: 'a1', username: 'alice', acct: 'alice' }, ...over,
}) as unknown as Status

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

type Page = Status[] & { nextMaxId?: string | null }
function clientWith(fetchTimeline: (kind: string, params?: { sinceId?: string; maxId?: string }) => Promise<Page>) {
  return { fetchTimeline } as unknown as CaribouClient
}

const alice = toUserKey('alice', 'example.social')
const bob = toUserKey('bob', 'example.social')

beforeEach(() => {
  statusCache.value = new Map()
  accountCache.value = new Map()
  activeUserKey.value = null
  ownerGeneration()
  _testOnlyResetMutations()
})
afterEach(() => {
  activeUserKey.value = null
  clearKeptAlive()
})

describe('account isolation', () => {
  it('an account change drops the reader flags from cached posts and keeps the posts', () => {
    activeUserKey.value = alice
    ownerGeneration()
    cacheStatus(st('p', { favourited: true, bookmarked: true }))
    cacheStatus(st('w', { reblog: st('p', { favourited: true }) }))
    activeUserKey.value = bob
    ownerGeneration()
    const kept = statusCache.value.get('p')!
    expect(kept.content).toBe('<p>p</p>')
    expect([kept.favourited, kept.bookmarked]).toEqual([undefined, undefined])
    expect(statusCache.value.get('w')!.reblog!.favourited).toBeUndefined()
    // Bob's copy of the post is not given Alice's flags.
    const merged = mergeStatus(st('p'))
    expect([merged.favourited, merged.bookmarked]).toEqual([false, false])
  })

  for (const [name, run] of [
    ['load', (s: ReturnType<typeof createTimelineStore>) => s.load()],
    ['loadMore', (s: ReturnType<typeof createTimelineStore>) => s.loadMore()],
    ['poll', (s: ReturnType<typeof createTimelineStore>) => s.poll()],
  ] as const) {
    it(`${name}() drops a page when the account changes after the request returns`, async () => {
      activeUserKey.value = alice
      ownerGeneration()
      const net = deferred<Page>()
      const initial = name === 'load' ? undefined : { statuses: [st('a')], nextMaxId: 'a' }
      const store = createTimelineStore('home', {
        clientSource: () => clientWith(() => net.promise),
        ...(initial ? { initial } : {}),
      })
      const running = run(store)
      // Runs after the store's own await on the request, before it commits.
      void net.promise.then(() => { activeUserKey.value = bob })
      net.resolve([st('private')])
      await running
      expect(statusCache.value.has('private')).toBe(false)
      expect(store.statusIds.value).not.toContain('private')
      expect(store.newPostsCount.value).toBe(0)
    })
  }
})

describe('merging around the reader\'s own actions', () => {
  it('a merge while a favourite is in flight does not break its rollback', async () => {
    cacheStatus(st('p', { favouritesCount: 5 }))
    const req = deferred<Status>()
    const client = { favourite: () => req.promise } as unknown as CaribouClient
    const running = toggleFavourite(st('p'), { clientSource: () => client })
    expect(statusCache.value.get('p')!.favouritesCount).toBe(6)
    mergeStatus(st('p', { favouritesCount: 5, content: '<p>edited</p>' }))
    req.reject(new Error('offline'))
    await running
    const p = statusCache.value.get('p')!
    expect([p.favourited, p.favouritesCount, p.content]).toEqual([false, 5, '<p>edited</p>'])
  })

  it('an older public copy does not lower the count of a post the reader favourited', () => {
    cacheStatus(st('p', { favourited: true, favouritesCount: 4 }))
    mergeStatus(st('p', { favouritesCount: 3 }))
    expect(statusCache.value.get('p')!.favouritesCount).toBe(4)
  })
})

describe('the new-posts buffer', () => {
  it('never holds a post that is already in the list, and applying never duplicates', async () => {
    const net = deferred<Page>()
    const store = createTimelineStore('local', {
      clientSource: () => clientWith(() => net.promise),
      initial: { statuses: [st('b')], nextMaxId: null },
    })
    const check = store.refresh()
    store.offer([st('c'), st('b')])
    store.applyNewPosts()
    net.resolve([st('c')])
    await check
    expect(store.newPostsCount.value).toBe(0)
    store._testOnlyPrepend([st('c')])
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['c', 'b'])
  })

  it('offer() keeps the posts between a polled post and the list', () => {
    const store = createTimelineStore('local', {
      clientSource: () => null, initial: { statuses: [st('b'), st('a')], nextMaxId: null },
    })
    store._testOnlyPrepend([st('z')])
    store.offer([st('z'), st('y'), st('x'), st('b'), st('a')])
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['z', 'y', 'x', 'b', 'a'])
  })

  // Round 3: a page offered after a check can bring posts older than the
  // post the check found. They go below it, not above.
  it('stays newest first when offer() brings posts older than a polled one', () => {
    const store = createTimelineStore('local', {
      clientSource: () => null, initial: { statuses: [st('200'), st('100')], nextMaxId: null },
    })
    store._testOnlyPrepend([st('1000')])
    store.offer([st('900'), st('300'), st('200'), st('100')])
    store.applyNewPosts()
    // '1000' is newer than '900': ids compare by length first.
    expect(store.statusIds.value).toEqual(['1000', '900', '300', '200', '100'])
  })
})

describe('an empty kept store', () => {
  it('offer() into an empty list sets up paging from the page', async () => {
    const calls: unknown[] = []
    const store = createTimelineStore('public', {
      clientSource: () => clientWith(async (_k, params) => { calls.push(params); return [] }),
      initial: { statuses: [], nextMaxId: null },
    })
    store.offer([st('new')], 'new')
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    expect(calls).toEqual([{ maxId: 'new' }])
  })

  it('refresh() on a store seeded empty by the server fetches', async () => {
    const calls: unknown[] = []
    const store = createTimelineStore('home', {
      clientSource: () => clientWith(async (_k, params) => { calls.push(params); return [st('a')] }),
      initial: { statuses: [], nextMaxId: null },
    })
    await store.refresh()
    expect(calls).toHaveLength(1)
    expect(store.statusIds.value).toEqual(['a'])
  })
})

describe('retry', () => {
  it('runs a failed loadMore again', async () => {
    let fail = true
    const store = createTimelineStore('home', {
      clientSource: () => clientWith(async (_k, params) => {
        if (params?.maxId && fail) throw new Error('offline')
        return params?.maxId ? [st('0')] : []
      }),
      initial: { statuses: [st('1')], nextMaxId: '1' },
    })
    await store.loadMore()
    expect(store.error.value?.message).toBe('offline')
    fail = false
    await store.retry()
    expect(store.error.value).toBeNull()
    expect(store.statusIds.value).toEqual(['1', '0'])
  })

  it('says which fetch failed, and forgets it when one works', async () => {
    let fail = true
    const store = createTimelineStore('home', {
      clientSource: () => clientWith(async (_k, params) => {
        if (fail) throw new Error('offline')
        return params?.maxId ? [st('0')] : []
      }),
      initial: { statuses: [st('1')], nextMaxId: '1' },
    })
    expect(store.failedOp.value).toBeNull()
    await store.loadMore()
    expect(store.failedOp.value).toBe('loadMore')
    await store.poll()
    expect(store.failedOp.value).toBe('poll')
    fail = false
    await store.retry()
    expect(store.failedOp.value).toBeNull()
  })
})

describe('ThreadStore.offer batches its writes', () => {
  it('writes the status cache once per offer', () => {
    const store = createThreadStore({} as unknown as CaribouClient, '1', {
      initial: { focused: st('1'), ancestors: [], descendants: [] },
    })
    let writes = 0
    const stop = statusCache.subscribe(() => { writes++ })
    writes = 0
    store.offer({ focused: st('1'), ancestors: [st('0')], descendants: [st('2'), st('3')] })
    stop()
    expect(writes).toBe(1)
  })
})
