import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import {
  loadRelationship, relationshipCache, relationshipFor, relationshipKey, toggleFollow,
} from '../relationships.js'
import { activeUserKey } from '../users.js'

const ME = 'alice@example.social' as UserKey
const BOB = { id: '7', acct: 'bob', locked: false }
const LOCKED = { id: '8', acct: 'carol', locked: true }

function rel(id: string, patch: Partial<mastodon.v1.Relationship> = {}): mastodon.v1.Relationship {
  return { id, following: false, requested: false, followedBy: false, ...patch } as mastodon.v1.Relationship
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeClient(over: Partial<CaribouClient> = {}): CaribouClient {
  return {
    userKey: ME,
    fetchRelationships: vi.fn(async (ids: readonly string[]) => ids.map((id) => rel(id))),
    follow: vi.fn(async (id: string) => rel(id, { following: true })),
    unfollow: vi.fn(async (id: string) => rel(id)),
    ...over,
  } as unknown as CaribouClient
}

const cached = (id: string) => relationshipCache.value.get(relationshipKey(ME, id))

let toasts: { kind: string; message: string }[]
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  relationshipCache.value = new Map()
  toasts = []
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  activeUserKey.value = null
})

describe('loadRelationship', () => {
  it('fetches the relationship and caches it under the signed-in user', async () => {
    const client = fakeClient({
      fetchRelationships: vi.fn(async () => [rel('7', { followedBy: true })]),
    })
    const r = await loadRelationship('7', { clientSource: () => client })
    expect(r?.followedBy).toBe(true)
    expect(cached('7')?.followedBy).toBe(true)
    expect(client.fetchRelationships).toHaveBeenCalledWith(['7'])
  })

  it('returns null without a client', async () => {
    expect(await loadRelationship('7', { clientSource: () => null })).toBeNull()
  })

  it('returns null when the server sends no relationship', async () => {
    const client = fakeClient({ fetchRelationships: vi.fn(async () => []) })
    expect(await loadRelationship('7', { clientSource: () => client })).toBeNull()
    expect(cached('7')).toBeUndefined()
  })

  it('returns null and caches nothing when the request fails', async () => {
    const client = fakeClient({ fetchRelationships: vi.fn(async () => { throw new Error('boom') }) })
    expect(await loadRelationship('7', { clientSource: () => client })).toBeNull()
    expect(cached('7')).toBeUndefined()
  })

  it('does not overwrite a write that started while it was loading', async () => {
    const read = deferred<mastodon.v1.Relationship[]>()
    const write = deferred<mastodon.v1.Relationship>()
    const client = fakeClient({
      fetchRelationships: vi.fn(() => read.promise),
      follow: vi.fn(() => write.promise),
    })
    const loading = loadRelationship('7', { clientSource: () => client })
    const toggling = toggleFollow(BOB, { clientSource: () => client })
    read.resolve([rel('7')])
    expect((await loading)?.following).toBe(true)
    expect(cached('7')?.following).toBe(true)
    write.resolve(rel('7', { following: true }))
    await toggling
  })

  // The read left before the click and lands after the write finished: what
  // it carries is older than the write's answer.
  it('does not overwrite a write that finished while it was loading', async () => {
    const read = deferred<mastodon.v1.Relationship[]>()
    const client = fakeClient({ fetchRelationships: vi.fn(() => read.promise) })
    const loading = loadRelationship('7', { clientSource: () => client })
    await toggleFollow(BOB, { clientSource: () => client })
    expect(cached('7')?.following).toBe(true)
    read.resolve([rel('7')])
    expect((await loading)?.following).toBe(true)
    expect(cached('7')?.following).toBe(true)
  })

  it('takes a read that started after the last write', async () => {
    const client = fakeClient({ fetchRelationships: vi.fn(async () => [rel('7', { followedBy: true })]) })
    await toggleFollow(BOB, { clientSource: () => client })
    await loadRelationship('7', { clientSource: () => client })
    expect(cached('7')).toMatchObject({ following: false, followedBy: true })
  })
})

describe('relationshipFor', () => {
  it('reads the active user’s entry', async () => {
    await loadRelationship('7', { clientSource: () => fakeClient() })
    expect(relationshipFor('7')).toBeUndefined()
    activeUserKey.value = ME
    expect(relationshipFor('7')?.id).toBe('7')
    expect(relationshipFor('7', 'bob@example.social' as UserKey)).toBeUndefined()
  })
})

describe('toggleFollow', () => {
  it('follows at once and keeps what the server returns', async () => {
    const write = deferred<mastodon.v1.Relationship>()
    const client = fakeClient({ follow: vi.fn(() => write.promise) })
    const p = toggleFollow(BOB, { clientSource: () => client })
    expect(cached('7')?.following).toBe(true)
    write.resolve(rel('7', { following: true, followedBy: true }))
    await p
    expect(cached('7')).toMatchObject({ following: true, followedBy: true })
    expect(client.unfollow).not.toHaveBeenCalled()
  })

  it('unfollows a followed account', async () => {
    const client = fakeClient()
    relationshipCache.value = new Map([[relationshipKey(ME, '7'), rel('7', { following: true, followedBy: true })]])
    const p = toggleFollow(BOB, { clientSource: () => client })
    expect(cached('7')).toMatchObject({ following: false, followedBy: true })
    await p
    expect(client.unfollow).toHaveBeenCalledWith('7')
    expect(cached('7')?.following).toBe(false)
  })

  it('rolls back and toasts when the follow fails', async () => {
    const client = fakeClient({ follow: vi.fn(async () => { throw new Error('boom') }) })
    relationshipCache.value = new Map([[relationshipKey(ME, '7'), rel('7', { followedBy: true })]])
    await toggleFollow(BOB, { clientSource: () => client })
    expect(cached('7')).toMatchObject({ following: false, followedBy: true })
    expect(toasts).toEqual([{ kind: 'error', message: "Couldn't follow @bob." }])
  })

  it('rolls back to nothing when there was no relationship before', async () => {
    const client = fakeClient({ follow: vi.fn(async () => { throw new Error('boom') }) })
    await toggleFollow(BOB, { clientSource: () => client })
    expect(cached('7')).toBeUndefined()
  })

  it('rolls back and toasts when the unfollow fails', async () => {
    const client = fakeClient({ unfollow: vi.fn(async () => { throw new Error('boom') }) })
    relationshipCache.value = new Map([[relationshipKey(ME, '7'), rel('7', { following: true })]])
    await toggleFollow(BOB, { clientSource: () => client })
    expect(cached('7')?.following).toBe(true)
    expect(toasts).toEqual([{ kind: 'error', message: "Couldn't unfollow @bob." }])
  })

  it('shows a request for a locked account', async () => {
    const client = fakeClient({ follow: vi.fn(async (id: string) => rel(id, { requested: true })) })
    const p = toggleFollow(LOCKED, { clientSource: () => client })
    expect(cached('8')).toMatchObject({ following: false, requested: true })
    await p
    expect(cached('8')).toMatchObject({ following: false, requested: true })
  })

  it('withdraws a pending request with an unfollow', async () => {
    const client = fakeClient()
    relationshipCache.value = new Map([[relationshipKey(ME, '8'), rel('8', { requested: true })]])
    const p = toggleFollow(LOCKED, { clientSource: () => client })
    expect(cached('8')).toMatchObject({ following: false, requested: false })
    await p
    expect(client.unfollow).toHaveBeenCalledWith('8')
    expect(client.follow).not.toHaveBeenCalled()
  })

  it('drops a second click while the first write is on its way', async () => {
    const write = deferred<mastodon.v1.Relationship>()
    const client = fakeClient({ follow: vi.fn(() => write.promise) })
    const first = toggleFollow(BOB, { clientSource: () => client })
    await toggleFollow(BOB, { clientSource: () => client })
    expect(client.unfollow).not.toHaveBeenCalled()
    write.resolve(rel('7', { following: true }))
    await first
    // Once the first write lands the account takes a new one.
    await toggleFollow(BOB, { clientSource: () => client })
    expect(client.unfollow).toHaveBeenCalledOnce()
  })

  it('does nothing without a client', async () => {
    await toggleFollow(BOB, { clientSource: () => null })
    expect(relationshipCache.value.size).toBe(0)
  })

  it('uses the active client by default, and there is none when signed out', async () => {
    await toggleFollow(BOB)
    expect(await loadRelationship('7')).toBeNull()
    expect(relationshipCache.value.size).toBe(0)
  })
})
