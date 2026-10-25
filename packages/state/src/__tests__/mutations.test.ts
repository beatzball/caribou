import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, statusCache } from '../caches.js'
import {
  _testOnlyResetMutations, toggleBookmark, toggleFavourite, toggleReblog,
} from '../mutations.js'

type Status = mastodon.v1.Status

function makeStatus(id: string, over: Partial<Status> = {}): Status {
  return {
    id, content: `<p>${id}</p>`,
    favourited: false, favouritesCount: 0,
    reblogged: false, reblogsCount: 0,
    bookmarked: false,
    account: { id: 'a1', username: 'alice', acct: 'alice' },
    ...over,
  } as unknown as Status
}

function wrapper(id: string, post: Status): Status {
  return makeStatus(id, { reblog: post, account: { id: 'a2', username: 'bob', acct: 'bob' } as mastodon.v1.Account })
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeClient(impl: Partial<CaribouClient>): CaribouClient {
  return impl as CaribouClient
}

const toasts: CustomEvent[] = []
const onToast = (e: Event) => { toasts.push(e as CustomEvent) }

beforeEach(() => {
  statusCache.value = new Map()
  _testOnlyResetMutations()
  toasts.length = 0
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => { window.removeEventListener('caribou:toast', onToast) })

const get = (id: string) => statusCache.value.get(id)!

describe('toggleFavourite', () => {
  it('flips the flag and count at once, then takes the server flag and count', async () => {
    cacheStatus(makeStatus('1', { favouritesCount: 4 }))
    const d = deferred<Status>()
    const favourite = vi.fn(() => d.promise)
    const p = toggleFavourite(get('1'), { clientSource: () => fakeClient({ favourite }) })

    expect(get('1').favourited).toBe(true)
    expect(get('1').favouritesCount).toBe(5)
    expect(favourite).toHaveBeenCalledWith('1')

    d.resolve(makeStatus('1', { favourited: true, favouritesCount: 7, content: '<p>fresh</p>' }))
    await p
    expect(get('1').favouritesCount).toBe(7)
    // Other fields stay as cached; only this action's fields come across.
    expect(get('1').content).toBe('<p>1</p>')
    expect(toasts).toHaveLength(0)
  })

  it('unfavourites a favourited post', async () => {
    cacheStatus(makeStatus('1', { favourited: true, favouritesCount: 1 }))
    const unfavourite = vi.fn(async () => makeStatus('1', { favourited: false, favouritesCount: 0 }))
    const p = toggleFavourite(get('1'), { clientSource: () => fakeClient({ unfavourite }) })
    expect(get('1').favourited).toBe(false)
    expect(get('1').favouritesCount).toBe(0)
    await p
    expect(unfavourite).toHaveBeenCalledWith('1')
  })

  it('never drops a count below zero', async () => {
    cacheStatus(makeStatus('1', { favourited: true, favouritesCount: 0 }))
    const d = deferred<Status>()
    const p = toggleFavourite(get('1'), { clientSource: () => fakeClient({ unfavourite: () => d.promise }) })
    expect(get('1').favouritesCount).toBe(0)
    d.resolve(makeStatus('1'))
    await p
  })

  it('rolls back and dispatches an error toast on failure', async () => {
    cacheStatus(makeStatus('1', { favouritesCount: 2 }))
    const favourite = vi.fn(async () => { throw new Error('500') })
    await toggleFavourite(get('1'), { clientSource: () => fakeClient({ favourite }) })
    expect(get('1').favourited).toBe(false)
    expect(get('1').favouritesCount).toBe(2)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.detail).toEqual({ kind: 'error', message: 'Could not favourite this post. Try again.' })
  })

  it('drops a second click while the first write is in flight', async () => {
    cacheStatus(makeStatus('1'))
    const d = deferred<Status>()
    const favourite = vi.fn(() => d.promise)
    const unfavourite = vi.fn()
    const client = fakeClient({ favourite, unfavourite })
    const first = toggleFavourite(get('1'), { clientSource: () => client })
    await toggleFavourite(get('1'), { clientSource: () => client })
    expect(favourite).toHaveBeenCalledOnce()
    expect(unfavourite).not.toHaveBeenCalled()
    expect(get('1').favouritesCount).toBe(1)

    d.resolve(makeStatus('1', { favourited: true, favouritesCount: 1 }))
    await first
    // The guard is released once the write settles.
    await toggleFavourite(get('1'), { clientSource: () => fakeClient({ unfavourite: async () => makeStatus('1') }) })
    expect(get('1').favourited).toBe(false)
  })

  it('does nothing without a client', async () => {
    cacheStatus(makeStatus('1'))
    const before = statusCache.value
    await toggleFavourite(get('1'), { clientSource: () => null })
    expect(statusCache.value).toBe(before)
  })

  it('uses the active client by default (none signed in: no-op)', async () => {
    cacheStatus(makeStatus('1'))
    await toggleFavourite(get('1'))
    expect(get('1').favourited).toBe(false)
  })
})

describe('boost wrappers', () => {
  it('acts on the inner post and updates every wrapper of it', async () => {
    const post = makeStatus('1', { favouritesCount: 3 })
    cacheStatus(post)
    cacheStatus(wrapper('w1', post))
    cacheStatus(wrapper('w2', post))
    cacheStatus(makeStatus('other'))
    const d = deferred<Status>()
    const favourite = vi.fn(() => d.promise)
    const p = toggleFavourite(get('w1'), { clientSource: () => fakeClient({ favourite }) })

    expect(favourite).toHaveBeenCalledWith('1')
    for (const id of ['1']) expect(get(id).favouritesCount).toBe(4)
    for (const id of ['w1', 'w2']) {
      expect(get(id).reblog!.favourited).toBe(true)
      expect(get(id).reblog!.favouritesCount).toBe(4)
      // The wrapper's own fields stay as they were.
      expect(get(id).favourited).toBe(false)
    }
    expect(get('other').favourited).toBe(false)

    d.resolve(makeStatus('1', { favourited: true, favouritesCount: 9 }))
    await p
    expect(get('1').favouritesCount).toBe(9)
    expect(get('w1').reblog!.favouritesCount).toBe(9)
    expect(get('w2').reblog!.favouritesCount).toBe(9)
  })

  it('works when only a wrapper is cached', async () => {
    const post = makeStatus('1', { reblogsCount: 1 })
    cacheStatus(wrapper('w1', post))
    const reblog = vi.fn(async () => makeStatus('1', { reblogged: true, reblogsCount: 2 }))
    const p = toggleReblog(get('w1'), { clientSource: () => fakeClient({ reblog }) })
    expect(get('w1').reblog!.reblogged).toBe(true)
    expect(get('w1').reblog!.reblogsCount).toBe(2)
    expect(statusCache.value.has('1')).toBe(false)
    await p
    expect(reblog).toHaveBeenCalledWith('1')
    expect(get('w1').reblog!.reblogsCount).toBe(2)
  })

  it('rolls back every wrapper on failure', async () => {
    const post = makeStatus('1', { reblogged: true, reblogsCount: 5 })
    cacheStatus(post)
    cacheStatus(wrapper('w1', post))
    await toggleReblog(get('1'), { clientSource: () => fakeClient({ unreblog: async () => { throw new Error('x') } }) })
    expect(get('1').reblogged).toBe(true)
    expect(get('1').reblogsCount).toBe(5)
    expect(get('w1').reblog!.reblogsCount).toBe(5)
    expect(toasts[0]!.detail.message).toBe('Could not undo the boost of this post. Try again.')
  })

  it('leaves the cache alone when the post is not cached at all', async () => {
    const before = statusCache.value
    await toggleBookmark(makeStatus('ghost'), {
      clientSource: () => fakeClient({ bookmark: async () => makeStatus('ghost', { bookmarked: true }) }),
    })
    expect(statusCache.value).toBe(before)
  })
})

describe('toggleBookmark', () => {
  it('flips bookmarked; there is no count', async () => {
    cacheStatus(makeStatus('1'))
    const bookmark = vi.fn(async () => makeStatus('1', { bookmarked: true }))
    const p = toggleBookmark(get('1'), { clientSource: () => fakeClient({ bookmark }) })
    expect(get('1').bookmarked).toBe(true)
    await p
    expect(get('1').bookmarked).toBe(true)
  })

  it('removes a bookmark and toasts on failure', async () => {
    cacheStatus(makeStatus('1', { bookmarked: true }))
    await toggleBookmark(get('1'), { clientSource: () => fakeClient({ unbookmark: async () => { throw new Error('x') } }) })
    expect(get('1').bookmarked).toBe(true)
    expect(toasts[0]!.detail.message).toBe('Could not remove the bookmark from this post. Try again.')
  })
})

describe('two actions on one post', () => {
  it('a response does not undo the optimistic flag of another action still in flight', async () => {
    cacheStatus(makeStatus('1'))
    const fav = deferred<Status>()
    const bm = deferred<Status>()
    const client = fakeClient({ favourite: () => fav.promise, bookmark: () => bm.promise })
    const p1 = toggleFavourite(get('1'), { clientSource: () => client })
    const p2 = toggleBookmark(get('1'), { clientSource: () => client })

    // The favourite response was made before the bookmark landed.
    fav.resolve(makeStatus('1', { favourited: true, favouritesCount: 1, bookmarked: false }))
    await p1
    expect(get('1').favourited).toBe(true)
    expect(get('1').bookmarked).toBe(true)

    bm.resolve(makeStatus('1', { favourited: true, favouritesCount: 1, bookmarked: true }))
    await p2
    expect(get('1').bookmarked).toBe(true)
  })

  it('keeps a count of another action in flight', async () => {
    cacheStatus(makeStatus('1'))
    const fav = deferred<Status>()
    const rb = deferred<Status>()
    const client = fakeClient({ favourite: () => fav.promise, reblog: () => rb.promise })
    const p1 = toggleFavourite(get('1'), { clientSource: () => client })
    const p2 = toggleReblog(get('1'), { clientSource: () => client })
    rb.resolve(makeStatus('1', { reblogged: true, reblogsCount: 1 }))
    await p2
    expect(get('1').favourited).toBe(true)
    expect(get('1').favouritesCount).toBe(1)
    fav.resolve(makeStatus('1', { favourited: true, favouritesCount: 1, reblogged: true, reblogsCount: 1 }))
    await p1
  })
})

describe('cache writes during the request', () => {
  it('rollback keeps a newer cache write and undoes only the delta', async () => {
    cacheStatus(makeStatus('1', { favouritesCount: 2 }))
    const d = deferred<Status>()
    const p = toggleFavourite(get('1'), { clientSource: () => fakeClient({ favourite: () => d.promise }) })
    // A poll lands mid-request: new content, and someone else favourited too.
    cacheStatus({ ...get('1'), content: '<p>edited</p>', favouritesCount: 6 })
    d.reject(new Error('500'))
    await p
    expect(get('1').content).toBe('<p>edited</p>')
    expect(get('1').favourited).toBe(false)
    expect(get('1').favouritesCount).toBe(5)
  })

  it('rollback leaves a flag that no longer holds the optimistic value', async () => {
    cacheStatus(makeStatus('1', { favouritesCount: 2 }))
    const d = deferred<Status>()
    const p = toggleFavourite(get('1'), { clientSource: () => fakeClient({ favourite: () => d.promise }) })
    // The server's own state arrived first and says not favourited.
    cacheStatus(makeStatus('1', { favouritesCount: 2 }))
    d.reject(new Error('timeout'))
    await p
    expect(get('1').favourited).toBe(false)
    expect(get('1').favouritesCount).toBe(2)
  })

  it('success merges only its own flag and count onto the current post', async () => {
    cacheStatus(makeStatus('1'))
    const fav = deferred<Status>()
    const bm = deferred<Status>()
    const client = fakeClient({ favourite: () => fav.promise, bookmark: () => bm.promise })
    const p1 = toggleFavourite(get('1'), { clientSource: () => client })
    const p2 = toggleBookmark(get('1'), { clientSource: () => client })

    fav.resolve(makeStatus('1', { favourited: true, favouritesCount: 1 }))
    await p1
    // The bookmark response was made before the favourite landed.
    bm.resolve(makeStatus('1', { bookmarked: true, favourited: false, favouritesCount: 0, content: '<p>old</p>' }))
    await p2
    expect(get('1').favourited).toBe(true)
    expect(get('1').favouritesCount).toBe(1)
    expect(get('1').bookmarked).toBe(true)
    expect(get('1').content).toBe('<p>1</p>')
  })
})

describe('server side', () => {
  it('does not dispatch a toast without a window', async () => {
    cacheStatus(makeStatus('1'))
    const saved = globalThis.window
    // @ts-expect-error simulate the server
    delete globalThis.window
    try {
      await toggleFavourite(get('1'), { clientSource: () => fakeClient({ favourite: async () => { throw new Error('x') } }) })
    } finally {
      globalThis.window = saved
    }
    expect(toasts).toHaveLength(0)
    expect(get('1').favourited).toBe(false)
  })
})
