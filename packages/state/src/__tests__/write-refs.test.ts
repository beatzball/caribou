import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, Relationship, Status, StatusBluesky } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, statusCache } from '../caches.js'
import { _testOnlyResetMutations, toggleFavourite, toggleReblog } from '../mutations.js'
import {
  _testOnlyResetRelationships, relationshipCache, relationshipKey, setBlock, toggleFollow,
} from '../relationships.js'

// Seams 2 and 3 (spec 6.3): writes send a ref, the result's record refs are
// committed, and a failure puts the old refs back. Mastodon never has these
// refs; the shapes below are what a Bluesky client will fill in.

const ME = 'did:plc:me@bsky' as UserKey
const POST_URI = 'at://did:plc:bob/app.bsky.feed.post/3k1'
const LIKE_URI = 'at://did:plc:me/app.bsky.feed.like/3l1'
const REPOST_URI = 'at://did:plc:me/app.bsky.feed.repost/3r1'

function bsky(over: Partial<StatusBluesky> = {}): StatusBluesky {
  return {
    uri: POST_URI, cid: 'bafy1', likeUri: null, repostUri: null,
    replyRef: null, replyDisabled: false, embeddingDisabled: false,
    labels: [], moderation: { contexts: {}, labelersCovered: [] } as unknown as StatusBluesky['moderation'],
    viewerOf: ME,
    ...over,
  }
}

function post(over: Partial<Status> = {}): Status {
  return {
    id: POST_URI, content: '<p>hi</p>',
    favourited: false, favouritesCount: 0,
    reblogged: false, reblogsCount: 0, bookmarked: false,
    account: { id: 'did:plc:bob', username: 'bob', acct: 'bob.example.com' },
    bluesky: bsky(),
    ...over,
  } as unknown as Status
}

const client = (impl: Partial<CaribouClient>) => ({ userKey: ME, ...impl }) as CaribouClient
const get = () => statusCache.value.get(POST_URI)!

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  statusCache.value = new Map()
  relationshipCache.value = new Map()
  _testOnlyResetMutations()
  _testOnlyResetRelationships()
})
afterEach(() => { vi.restoreAllMocks() })

describe('status writes send refs and commit the record refs', () => {
  it('sends the post ref and commits the like record the result carries', async () => {
    cacheStatus(post())
    const favourite = vi.fn(async () => post({
      favourited: true, favouritesCount: 1, bluesky: bsky({ likeUri: LIKE_URI }),
    }))
    await toggleFavourite(get(), { clientSource: () => client({ favourite }) })
    expect(favourite).toHaveBeenCalledWith({
      id: POST_URI, bluesky: { uri: POST_URI, cid: 'bafy1', likeUri: null, repostUri: null },
    })
    expect(get().favourited).toBe(true)
    expect(get().bluesky?.likeUri).toBe(LIKE_URI)
  })

  it('sends the like record to the unlike, and commits its removal', async () => {
    cacheStatus(post({ favourited: true, favouritesCount: 1, bluesky: bsky({ likeUri: LIKE_URI }) }))
    const d = deferred<Status>()
    const unfavourite = vi.fn(() => d.promise)
    const p = toggleFavourite(get(), { clientSource: () => client({ unfavourite }) })
    expect(unfavourite.mock.calls[0]).toEqual([expect.objectContaining({
      bluesky: expect.objectContaining({ likeUri: LIKE_URI }),
    })])
    // The like is gone at once, and its record with it.
    expect(get().bluesky?.likeUri).toBeNull()
    d.resolve(post({ favourited: false, favouritesCount: 0, bluesky: bsky() }))
    await p
    expect(get().bluesky?.likeUri).toBeNull()
  })

  it('restores the like record when the unlike fails', async () => {
    cacheStatus(post({ favourited: true, favouritesCount: 1, bluesky: bsky({ likeUri: LIKE_URI }) }))
    const unfavourite = vi.fn(async () => { throw new Error('500') })
    await toggleFavourite(get(), { clientSource: () => client({ unfavourite }) })
    expect(get().favourited).toBe(true)
    expect(get().bluesky?.likeUri).toBe(LIKE_URI)
  })

  it('commits the repost record, and keeps the like record as it was', async () => {
    cacheStatus(post({ favourited: true, bluesky: bsky({ likeUri: LIKE_URI }) }))
    // The result may lag on the other slot; only this action's ref comes across.
    const reblog = vi.fn(async () => post({ reblogged: true, reblogsCount: 1, bluesky: bsky({ repostUri: REPOST_URI }) }))
    await toggleReblog(get(), { clientSource: () => client({ reblog }) })
    expect(get().bluesky?.repostUri).toBe(REPOST_URI)
    expect(get().bluesky?.likeUri).toBe(LIKE_URI)
  })

  it('sends only the id for a Mastodon post, and adds no bluesky field', async () => {
    const mastodon = (over: Partial<Status> = {}) => {
      const { bluesky: _none, ...rest } = post({ id: '1', ...over })
      return rest as Status
    }
    cacheStatus(mastodon())
    const favourite = vi.fn(async () => mastodon({ favourited: true, favouritesCount: 1 }))
    await toggleFavourite(statusCache.value.get('1')!, { clientSource: () => client({ favourite }) })
    expect(favourite).toHaveBeenCalledWith({ id: '1' })
    expect('bluesky' in statusCache.value.get('1')!).toBe(false)
  })
})

describe('relationship writes send refs and commit the record refs', () => {
  const BOB = { id: 'did:plc:bob', acct: 'bob.example.com', locked: false }
  const FOLLOW_URI = 'at://did:plc:me/app.bsky.graph.follow/3f1'
  const BLOCK_URI = 'at://did:plc:me/app.bsky.graph.block/3b1'
  const key = relationshipKey(ME, BOB.id)
  const rel = (patch: Partial<Relationship> = {}): Relationship => ({
    id: BOB.id, following: false, requested: false, blocking: false, muting: false,
    bluesky: { followUri: null, blockUri: null }, ...patch,
  } as Relationship)

  it('commits the follow record, and the unfollow after it sends that record', async () => {
    const follow = vi.fn(async () => rel({ following: true, bluesky: { followUri: FOLLOW_URI, blockUri: null } }))
    const unfollow = vi.fn(async () => rel())
    const c = client({ follow, unfollow })
    await toggleFollow(BOB, { clientSource: () => c })
    expect(follow).toHaveBeenCalledWith({ id: BOB.id })
    expect(relationshipCache.value.get(key)?.bluesky?.followUri).toBe(FOLLOW_URI)
    await toggleFollow(BOB, { clientSource: () => c })
    expect(unfollow).toHaveBeenCalledWith({ id: BOB.id, bluesky: { followUri: FOLLOW_URI, blockUri: null } })
    expect(relationshipCache.value.get(key)?.bluesky?.followUri).toBeNull()
  })

  it('an unblock queued behind a block sends the block record the block returned', async () => {
    relationshipCache.value = new Map([[key, rel()]])
    const d = deferred<Relationship>()
    const block = vi.fn(() => d.promise)
    const unblock = vi.fn(async () => rel())
    const c = client({ block, unblock })
    const on = setBlock(BOB, true, { clientSource: () => c })
    const off = setBlock(BOB, false, { clientSource: () => c })
    d.resolve(rel({ blocking: true, bluesky: { followUri: null, blockUri: BLOCK_URI } }))
    await Promise.all([on, off])
    expect(unblock).toHaveBeenCalledWith({ id: BOB.id, bluesky: { followUri: null, blockUri: BLOCK_URI } })
  })

  it('restores the follow record when the unfollow fails', async () => {
    relationshipCache.value = new Map([[key, rel({ following: true, bluesky: { followUri: FOLLOW_URI, blockUri: null } })]])
    const unfollow = vi.fn(async () => { throw new Error('500') })
    await toggleFollow(BOB, { clientSource: () => client({ unfollow }) })
    expect(relationshipCache.value.get(key)?.following).toBe(true)
    expect(relationshipCache.value.get(key)?.bluesky?.followUri).toBe(FOLLOW_URI)
  })
})
