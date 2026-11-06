import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effect } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, Relationship } from '@beatzball/caribou-mastodon-client'
import {
  _testOnlyResetRelationships, loadRelationships, relationshipCache, relationshipKey, toggleFollow,
} from '../relationships.js'

const ME = 'alice@example.social' as UserKey

function rel(id: string, patch: Partial<Relationship> = {}): Relationship {
  return { id, following: false, requested: false, followedBy: false, ...patch } as Relationship
}

function fakeClient(over: Partial<CaribouClient> = {}): CaribouClient {
  return {
    userKey: ME,
    fetchRelationships: vi.fn(async (ids: readonly string[]) => ids.map((id) => rel(id, { followedBy: true }))),
    follow: vi.fn(async ({ id }: { id: string }) => rel(id, { following: true })),
    unfollow: vi.fn(async ({ id }: { id: string }) => rel(id)),
    ...over,
  } as unknown as CaribouClient
}

const cached = (id: string) => relationshipCache.value.get(relationshipKey(ME, id))

beforeEach(() => {
  _testOnlyResetRelationships()
  relationshipCache.value = new Map()
})

describe('loadRelationships', () => {
  it('reads several accounts in one request and caches each', async () => {
    const client = fakeClient()
    await loadRelationships(['1', '2', '3'], { clientSource: () => client })
    expect(client.fetchRelationships).toHaveBeenCalledOnce()
    expect(client.fetchRelationships).toHaveBeenCalledWith(['1', '2', '3'])
    expect(cached('2')?.followedBy).toBe(true)
  })

  it('asks for at most 40 ids per request', async () => {
    const client = fakeClient()
    const ids = Array.from({ length: 45 }, (_, i) => String(i))
    await loadRelationships(ids, { clientSource: () => client })
    expect(client.fetchRelationships).toHaveBeenCalledTimes(2)
    expect(cached('44')).toBeDefined()
  })

  it('does nothing without a client or ids', async () => {
    const client = fakeClient()
    await loadRelationships([], { clientSource: () => client })
    await loadRelationships(['1'], { clientSource: () => null })
    expect(client.fetchRelationships).not.toHaveBeenCalled()
  })

  it('keeps a follow that started while the read was out', async () => {
    let answer!: (r: Relationship[]) => void
    const client = fakeClient({
      fetchRelationships: vi.fn(() => new Promise<Relationship[]>((r) => { answer = r })),
    })
    const opts = { clientSource: () => client }
    const loading = loadRelationships(['7', '8'], opts)
    await toggleFollow({ id: '7', acct: 'bob', locked: false }, opts)
    answer([rel('7'), rel('8', { followedBy: true })])
    await loading
    expect(cached('7')?.following).toBe(true)
    expect(cached('8')?.followedBy).toBe(true)
  })

  it('swallows a failed read', async () => {
    const client = fakeClient({ fetchRelationships: vi.fn(async () => { throw new Error('down') }) })
    await expect(loadRelationships(['1'], { clientSource: () => client })).resolves.toBeUndefined()
  })

  // Review round 1 (Codex 5): a follow already on its way when the read starts.
  it('keeps a follow that was still waiting when the read started', async () => {
    let answerFollow!: (r: Relationship) => void
    const client = fakeClient({
      follow: vi.fn(() => new Promise<Relationship>((r) => { answerFollow = r })),
    })
    const opts = { clientSource: () => client }
    const following = toggleFollow({ id: '7', acct: 'bob', locked: false }, opts)
    expect(cached('7')?.following).toBe(true)
    await loadRelationships(['7'], opts)
    expect(cached('7')?.following).toBe(true)
    answerFollow(rel('7', { following: true }))
    await following
    expect(cached('7')?.following).toBe(true)
  })

  // Review round 1 (Fable F8): one batch is one cache change.
  it('writes the cache once for a whole batch', async () => {
    const client = fakeClient()
    let writes = -1
    const stop = effect(() => { void relationshipCache.value; writes++ })
    await loadRelationships(['1', '2', '3'], { clientSource: () => client })
    stop()
    expect(writes).toBe(1)
    expect(cached('3')).toBeDefined()
  })
})
