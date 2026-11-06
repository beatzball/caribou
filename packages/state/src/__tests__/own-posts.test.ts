import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaribouClient, Account, Status } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import { cacheStatus, deletedStatusIds, statusCache } from '../caches.js'
import { activeUserKey } from '../users.js'
import { ownerGeneration } from '../keep-alive.js'
import { deleteOwnStatus, editOwnStatus, isDeletedStatus } from '../own-posts.js'


function makeStatus(id: string, over: Partial<Status> = {}): Status {
  return {
    id, content: `<p>${id}</p>`, editedAt: null,
    favourited: false, favouritesCount: 0, reblogged: false, reblogsCount: 0, bookmarked: false,
    account: { id: 'me', username: 'alice', acct: 'alice' },
    ...over,
  } as unknown as Status
}

function wrapper(id: string, post: Status): Status {
  return makeStatus(id, { reblog: post, account: { id: 'b', username: 'bob', acct: 'bob' } as Account })
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const client = (impl: Partial<CaribouClient>) => impl as CaribouClient
const toasts: string[] = []
const onToast = (e: Event) => { toasts.push((e as CustomEvent<{ message: string }>).detail.message) }

beforeEach(() => {
  activeUserKey.value = toUserKey('alice', 'example.social')
  ownerGeneration()
  statusCache.value = new Map()
  deletedStatusIds.value = new Set()
  toasts.length = 0
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => { window.removeEventListener('caribou:toast', onToast) })

const get = (id: string) => statusCache.value.get(id)

describe('editOwnStatus', () => {
  it('writes the edited post to the cache, in place and inside every boost of it, keeping reader flags', async () => {
    cacheStatus(makeStatus('1', { favourited: true, favouritesCount: 3 }))
    cacheStatus(wrapper('w1', makeStatus('1')))
    const edited = makeStatus('1', { content: '<p>fixed</p>', editedAt: '2026-11-01T00:00:00.000Z', favouritesCount: 3 })
    const editStatus = vi.fn(async () => edited)
    const out = await editOwnStatus(client({ editStatus }), '1', { status: 'fixed', spoilerText: '', mediaIds: [] })
    expect(editStatus).toHaveBeenCalledWith('1', { status: 'fixed', spoilerText: '', mediaIds: [] })
    expect(out?.content).toBe('<p>fixed</p>')
    expect(get('1')?.content).toBe('<p>fixed</p>')
    expect(get('1')?.favourited).toBe(true)
    expect(get('w1')?.reblog?.content).toBe('<p>fixed</p>')
    expect(get('w1')?.reblog?.editedAt).toBe('2026-11-01T00:00:00.000Z')
  })

  it('rethrows a failure and leaves the cache as it was', async () => {
    cacheStatus(makeStatus('1'))
    const editStatus = vi.fn(async () => { throw new Error('boom') })
    await expect(editOwnStatus(client({ editStatus }), '1', { status: 'x', spoilerText: '', mediaIds: [] }))
      .rejects.toThrow('boom')
    expect(get('1')?.content).toBe('<p>1</p>')
  })

  it('drops a result that lands after the account changed', async () => {
    cacheStatus(makeStatus('1'))
    const d = deferred<Status>()
    const p = editOwnStatus(client({ editStatus: () => d.promise }), '1', { status: 'x', spoilerText: '', mediaIds: [] })
    activeUserKey.value = toUserKey('bob', 'example.social')
    d.resolve(makeStatus('1', { content: '<p>late</p>' }))
    expect(await p).toBeNull()
    expect(get('1')?.content).toBe('<p>1</p>')
  })
})

describe('deleteOwnStatus', () => {
  it('removes the post and its boosts at once, marks it deleted, and returns the server copy', async () => {
    cacheStatus(makeStatus('1'))
    cacheStatus(wrapper('w1', makeStatus('1')))
    cacheStatus(makeStatus('2'))
    const d = deferred<Status>()
    const p = deleteOwnStatus(client({ deleteStatus: () => d.promise }), makeStatus('1'))
    expect(get('1')).toBeUndefined()
    expect(get('w1')).toBeUndefined()
    expect(get('2')).toBeDefined()
    expect(isDeletedStatus('1')).toBe(true)
    d.resolve(makeStatus('1', { text: 'source' } as Partial<Status>))
    const out = await p
    expect(out?.text).toBe('source')
    expect(isDeletedStatus('1')).toBe(true)
  })

  it('puts everything back and toasts when the server refuses', async () => {
    cacheStatus(makeStatus('1'))
    cacheStatus(wrapper('w1', makeStatus('1')))
    const out = await deleteOwnStatus(client({ deleteStatus: async () => { throw new Error('nope') } }), makeStatus('1'))
    expect(out).toBeNull()
    expect(get('1')).toBeDefined()
    expect(get('w1')?.reblog?.id).toBe('1')
    expect(isDeletedStatus('1')).toBe(false)
    expect(toasts).toEqual(['Could not delete this post. Try again.'])
  })

  it('deletes the inner post when given a boost wrapper', async () => {
    const post = makeStatus('1')
    cacheStatus(wrapper('w1', post))
    const deleteStatus = vi.fn(async () => post)
    await deleteOwnStatus(client({ deleteStatus }), wrapper('w1', post))
    expect(deleteStatus).toHaveBeenCalledWith('1')
  })

  it('writes nothing, not even the rollback, after the account changed', async () => {
    cacheStatus(makeStatus('1'))
    const d = deferred<Status>()
    const p = deleteOwnStatus(client({ deleteStatus: () => d.promise }), makeStatus('1'))
    activeUserKey.value = toUserKey('bob', 'example.social')
    ownerGeneration()
    d.reject(new Error('nope'))
    expect(await p).toBeNull()
    expect(toasts).toEqual([])
    expect(isDeletedStatus('1')).toBe(false)
  })
})

describe('mergeStatus and edits', () => {
  it('an older copy (page data from an upstream cache) does not undo an edit', async () => {
    const { mergeStatus } = await import('../caches.js')
    cacheStatus(makeStatus('1', { content: '<p>fixed</p>', editedAt: '2026-11-01T00:00:00.000Z', favouritesCount: 1 }))
    mergeStatus(makeStatus('1', { content: '<p>typo</p>', editedAt: null, favouritesCount: 4 }))
    expect(get('1')?.content).toBe('<p>fixed</p>')
    expect(get('1')?.editedAt).toBe('2026-11-01T00:00:00.000Z')
    expect(get('1')?.favouritesCount).toBe(4)
    mergeStatus(makeStatus('1', { content: '<p>newer</p>', editedAt: '2026-11-02T00:00:00.000Z' }))
    expect(get('1')?.content).toBe('<p>newer</p>')
  })
})

describe('review round 1: an older copy never undoes an edit', () => {
  const EDITED = '2026-11-01T00:00:00.000Z'

  it('a late timeline page fetched before the edit does not undo it (cacheStatus path)', async () => {
    const { createTimelineStore } = await import('../timeline-store.js')
    cacheStatus(makeStatus('1', { content: '<p>old</p>' }))
    const page = deferred<Status[]>()
    const store = createTimelineStore('home', {
      clientSource: () => client({ fetchTimeline: () => page.promise as never }),
    })
    const loading = store.load()
    await editOwnStatus(client({ editStatus: async () => makeStatus('1', { content: '<p>new</p>', editedAt: EDITED }) }),
      '1', { status: 'new', spoilerText: '', mediaIds: [] })
    page.resolve([makeStatus('1', { content: '<p>old</p>', favouritesCount: 9 })])
    await loading
    expect(get('1')?.content).toBe('<p>new</p>')
    expect(get('1')?.editedAt).toBe(EDITED)
    // Everything else still comes from the fresh copy.
    expect(get('1')?.favouritesCount).toBe(9)
  })

  it('a late boost carrying the old post does not undo the edit inside it', () => {
    cacheStatus(makeStatus('1', { content: '<p>new</p>', editedAt: EDITED }))
    cacheStatus(wrapper('w1', makeStatus('1', { content: '<p>old</p>' })))
    expect(get('w1')?.reblog?.content).toBe('<p>new</p>')
  })

  it('an edit of a post cached only inside a boost caches the post itself', async () => {
    cacheStatus(wrapper('w1', makeStatus('1', { content: '<p>old</p>' })))
    await editOwnStatus(client({ editStatus: async () => makeStatus('1', { content: '<p>new</p>', editedAt: EDITED }) }),
      '1', { status: 'new', spoilerText: '', mediaIds: [] })
    expect(get('1')?.content).toBe('<p>new</p>')
    expect(get('w1')?.reblog?.content).toBe('<p>new</p>')
    // Stale page data for the post now has a newer copy to lose against.
    const { mergeStatus } = await import('../caches.js')
    mergeStatus(makeStatus('1', { content: '<p>old</p>' }))
    expect(get('1')?.content).toBe('<p>new</p>')
  })

  it('two overlapping edits answered newest first: the older answer does not win', async () => {
    cacheStatus(wrapper('w1', makeStatus('1', { content: '<p>old</p>' })))
    const first = deferred<Status>()
    const second = deferred<Status>()
    const p1 = editOwnStatus(client({ editStatus: () => first.promise }), '1', { status: 'first', spoilerText: '', mediaIds: [] })
    const p2 = editOwnStatus(client({ editStatus: () => second.promise }), '1', { status: 'second', spoilerText: '', mediaIds: [] })
    second.resolve(makeStatus('1', { content: '<p>second</p>', editedAt: '2026-11-01T00:00:02.000Z' }))
    await p2
    first.resolve(makeStatus('1', { content: '<p>first</p>', editedAt: '2026-11-01T00:00:01.000Z' }))
    await p1
    expect(get('w1')?.reblog?.content).toBe('<p>second</p>')
    expect(get('1')?.content).toBe('<p>second</p>')
  })

  it('an edit answer is cached even when no copy of the post was', async () => {
    await editOwnStatus(client({ editStatus: async () => makeStatus('1', { content: '<p>new</p>', editedAt: EDITED }) }),
      '1', { status: 'new', spoilerText: '', mediaIds: [] })
    expect(get('1')?.content).toBe('<p>new</p>')
  })
})

describe('review round 1: a deleted post stays gone after A -> B -> A', () => {
  it('a copy a poll brought back while the delete was out leaves the cache on the account change', async () => {
    cacheStatus(makeStatus('1'))
    cacheStatus(makeStatus('2'))
    const d = deferred<Status>()
    const p = deleteOwnStatus(client({ deleteStatus: () => d.promise }), makeStatus('1'))
    // A poll lands meanwhile and brings the post and a boost of it back.
    cacheStatus(makeStatus('1'))
    cacheStatus(wrapper('w1', makeStatus('1')))
    d.resolve(makeStatus('1'))
    await p
    activeUserKey.value = toUserKey('bob', 'example.social')
    ownerGeneration()
    activeUserKey.value = toUserKey('alice', 'example.social')
    ownerGeneration()
    expect(get('1')).toBeUndefined()
    expect(get('w1')).toBeUndefined()
    expect(get('2')).toBeDefined()
  })
})
