import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import { CaribouError, type CaribouClient } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, statusCache } from '../caches.js'
import { loadReaderView } from '../reader-view.js'
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

beforeEach(() => { statusCache.value = new Map() })

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

  it('on an older server fetches each post alone, and skips the ones that fail', async () => {
    const c = client({
      fetchStatuses: vi.fn(async () => { throw new CaribouError('not_found', 'no') }),
      fetchStatus: vi.fn(async (id: string) => {
        if (id === '2') throw new Error('gone')
        return post(id, { filtered: HIDE })
      }),
    })
    await loadReaderView([post('1'), post('2')], c)
    expect(c.fetchStatus).toHaveBeenCalledTimes(2)
    expect(statusCache.value.get('1')!.filtered).toEqual(HIDE)
    expect(statusCache.value.has('2')).toBe(false)
  })

  it('drops an answer that is another post under the same id', async () => {
    const c = client({ fetchStatuses: vi.fn(async () => [post('1', { uri: 'https://other.example/x', filtered: HIDE })]) })
    cacheStatus(post('1'))
    await loadReaderView([post('1')], c)
    expect(statusCache.value.get('1')!.content).toBe('<p>1</p>')
    expect(statusCache.value.get('1')!.filtered).toBeUndefined()
  })

  it('gives up quietly on another error', async () => {
    const c = client({ fetchStatuses: vi.fn(async () => { throw new Error('boom') }) })
    await expect(loadReaderView([post('1')], c)).resolves.toBeUndefined()
    expect(c.fetchStatus).not.toHaveBeenCalled()
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
