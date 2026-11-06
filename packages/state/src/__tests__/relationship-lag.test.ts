import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, Relationship } from '@beatzball/caribou-mastodon-client'
import {
  _testOnlyResetRelationships, loadRelationship, loadRelationships, relationshipCache, relationshipKey, toggleFollow,
} from '../relationships.js'

// The lag rule for relationships (package README, "Viewer state"): for the
// client's `readLagMs` after a write finished (60 s for Bluesky), a read
// that disagrees with it does not replace the cached relationship.
// Mastodon's is 0: relationships.test.ts "takes a read that started after
// the last write" keeps that.

const ME = 'did:plc:me@bsky' as UserKey
const rel = (over: Partial<Relationship> = {}) => ({
  id: 'did:plc:bob', following: false, requested: false, muting: false, blocking: false, ...over,
}) as Relationship

function client(read: Relationship): CaribouClient {
  return {
    userKey: ME,
    capabilities: { readLagMs: 60_000 },
    follow: async () => rel({ following: true }),
    fetchRelationships: async () => [read],
  } as unknown as CaribouClient
}

const shown = () => relationshipCache.value.get(relationshipKey(ME, 'did:plc:bob'))

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] })
  relationshipCache.value = new Map()
  _testOnlyResetRelationships()
})
afterEach(() => { vi.useRealTimers() })

describe('a read after a follow', () => {
  it('inside 60 s, a read that says not following is ignored; after it, the read wins', async () => {
    const c = client(rel())
    await toggleFollow({ id: 'did:plc:bob', acct: 'bob.example.com', locked: false }, { clientSource: () => c })
    expect(shown()?.following).toBe(true)

    vi.setSystemTime(1_000_000 + 30_000)
    await loadRelationship('did:plc:bob', { clientSource: () => c })
    expect(shown()?.following).toBe(true)
    await loadRelationships(['did:plc:bob'], { clientSource: () => c })
    expect(shown()?.following).toBe(true)

    vi.setSystemTime(1_000_000 + 60_001)
    await loadRelationship('did:plc:bob', { clientSource: () => c })
    expect(shown()?.following).toBe(false)
  })

  it('inside 60 s, a read that agrees is taken', async () => {
    const c = client(rel({ following: true, notifying: true }))
    await toggleFollow({ id: 'did:plc:bob', acct: 'bob.example.com', locked: false }, { clientSource: () => c })
    vi.setSystemTime(1_000_000 + 5_000)
    await loadRelationship('did:plc:bob', { clientSource: () => c })
    expect(shown()?.notifying).toBe(true)
  })
})
