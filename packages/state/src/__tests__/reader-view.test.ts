import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import { CaribouError, type CaribouClient } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, filteredById, statusCache } from '../caches.js'
import { loadReaderView, readerCheckFor, readerChecks } from '../reader-view.js'
import { createThreadStore } from '../thread-store.js'
import { createProfileStore } from '../profile-store.js'
import { createTimelineStore } from '../timeline-store.js'

type Status = mastodon.v1.Status

const HIDE = [{ filter: { id: 'f', title: 'Spoilers', context: ['public', 'thread', 'account'], filterAction: 'hide' } }]

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, uri: `https://example.social/statuses/${id}`, content: `<p>${id}</p>`,
  account: { id: 'a', acct: 'bob' }, ...over,
}) as unknown as Status

function client(over: Partial<CaribouClient> = {}): CaribouClient {
  return {
    userKey: 'alice@example.social',
    fetchStatuses: vi.fn(async (ids: readonly string[]) => ids.map((id) => post(id, { filtered: HIDE }))),
    fetchStatus: vi.fn(async (id: string) => post(id, { filtered: HIDE })),
    ...over,
  } as unknown as CaribouClient
}

beforeEach(() => {
  statusCache.value = new Map()
  filteredById.value = new Map()
  readerChecks.value = new Map()
})

const check = (id: string) => readerCheckFor('alice@example.social', id)

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('loadReaderView', () => {
  it('merges the reader\'s copies, with `filtered`, into the cache', async () => {
    const c = client()
    cacheStatus(post('1'))
    cacheStatus(post('2'))
    await loadReaderView([post('1'), post('2')], c)
    expect(c.fetchStatuses).toHaveBeenCalledWith(['1', '2'])
    expect(statusCache.value.get('1')!.filtered).toEqual(HIDE)
    expect(statusCache.value.get('2')!.filtered).toEqual(HIDE)
  })

  it('asks in batches of 20', async () => {
    const c = client()
    const many = Array.from({ length: 45 }, (_, i) => post(String(i)))
    await loadReaderView(many, c)
    expect(vi.mocked(c.fetchStatuses).mock.calls.map(([ids]) => ids.length)).toEqual([20, 20, 5])
  })

  it('on an older server fetches every post alone; the ones that fail stay failed', async () => {
    const c = client({
      fetchStatuses: vi.fn(async () => { throw new CaribouError('not_found', 'no') }),
      fetchStatus: vi.fn(async (id: string) => {
        if (id === '2') throw new Error('gone')
        return post(id, { filtered: HIDE })
      }),
    })
    const many = Array.from({ length: 45 }, (_, i) => post(String(i)))
    await loadReaderView(many, c)
    expect(c.fetchStatus).toHaveBeenCalledTimes(45)
    expect(statusCache.value.get('44')!.filtered).toEqual(HIDE)
    expect(check('44')).toBeUndefined()
    expect(check('2')).toBe('failed')
  })

  it('a post is pending while the request is out, and settled after', async () => {
    const d = deferred<Status[]>()
    const c = client({ fetchStatuses: vi.fn(() => d.promise) })
    const done = loadReaderView([post('1')], c)
    expect(check('1')).toBe('pending')
    d.resolve([post('1', { filtered: [] })])
    await done
    expect(check('1')).toBeUndefined()
  })

  it('an error leaves every post failed', async () => {
    const c = client({ fetchStatuses: vi.fn(async () => { throw new Error('boom') }) })
    await loadReaderView([post('1'), post('2')], c)
    expect([check('1'), check('2')]).toEqual(['failed', 'failed'])
    expect(c.fetchStatus).not.toHaveBeenCalled()
  })

  it('a post the server leaves out is failed; the others settle', async () => {
    const c = client({ fetchStatuses: vi.fn(async () => [post('1', { filtered: [] })]) })
    await loadReaderView([post('1'), post('2')], c)
    expect(check('1')).toBeUndefined()
    expect(check('2')).toBe('failed')
  })

  it('one failed batch leaves the other batches settled', async () => {
    const c = client({
      fetchStatuses: vi.fn(async (ids: readonly string[]) => {
        if (ids.includes('25')) throw new Error('boom')
        return ids.map((id) => post(id, { filtered: [] }))
      }),
    })
    await loadReaderView(Array.from({ length: 30 }, (_, i) => post(String(i))), c)
    expect(check('0')).toBeUndefined()
    expect(check('25')).toBe('failed')
  })

  it('a post whose filters are known already is not covered while it is asked again', async () => {
    cacheStatus(post('1', { filtered: [] }))
    const d = deferred<Status[]>()
    const c = client({ fetchStatuses: vi.fn(() => d.promise) })
    const done = loadReaderView([post('1')], c)
    expect(check('1')).toBeUndefined()
    d.reject(new Error('boom'))
    await done
    expect(check('1')).toBeUndefined()
  })

  it('drops an answer that is another post under the same id', async () => {
    const c = client({ fetchStatuses: vi.fn(async () => [post('1', { uri: 'https://other.example/x', filtered: HIDE })]) })
    cacheStatus(post('1'))
    await loadReaderView([post('1')], c)
    expect(statusCache.value.get('1')!.content).toBe('<p>1</p>')
    expect(statusCache.value.get('1')!.filtered).toBeUndefined()
  })

})

// The server's copy has no reader state. A store seeded with it must not
// throw away the reader's copy the cache already has.
describe('stores seeded with server data keep the reader\'s cached copy', () => {
  it('thread', () => {
    cacheStatus(post('1', { filtered: HIDE, favourited: true }))
    createThreadStore(client(), '1', { initial: { focused: post('1'), ancestors: [], descendants: [] } })
    expect(statusCache.value.get('1')).toMatchObject({ filtered: HIDE, favourited: true })
  })

  it('profile', () => {
    cacheStatus(post('1', { filtered: HIDE }))
    createProfileStore('a', 'posts', { clientSource: () => null, initial: { statuses: [post('1')], nextMaxId: null } })
    expect(statusCache.value.get('1')!.filtered).toEqual(HIDE)
  })

  it('timeline', () => {
    cacheStatus(post('1', { filtered: HIDE }))
    createTimelineStore('local', { clientSource: () => null, initial: { statuses: [post('1')], nextMaxId: null } })
    expect(statusCache.value.get('1')!.filtered).toEqual(HIDE)
  })
})
