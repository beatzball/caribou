import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import type {
  CaribouClient, Relationship, RelationshipWriteAck, Status, StatusBluesky, StatusRef, StatusWriteAck,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus, forgetReaderFields, statusCache } from '../caches.js'
import { ownerGeneration } from '../keep-alive.js'
import { _testOnlyResetMutations, toggleBookmark, toggleFavourite, toggleReblog } from '../mutations.js'
import {
  _testOnlyResetRelationships, relationshipCache, relationshipKey, setBlock, setMute, toggleFollow,
} from '../relationships.js'
import { activeUserKey } from '../users.js'

// A Bluesky write answers an ack, not a post (README, "Bluesky acks").

const ME = 'did:plc:me@bsky' as UserKey
const POST_URI = 'at://did:plc:bob/app.bsky.feed.post/3k1'
const LIKE_URI = 'at://did:plc:me/app.bsky.feed.like/3l1'
const REPOST_URI = 'at://did:plc:me/app.bsky.feed.repost/3r1'
const FOLLOW_URI = 'at://did:plc:me/app.bsky.graph.follow/3f1'
const BLOCK_URI = 'at://did:plc:me/app.bsky.graph.block/3b1'
const BOB = { id: 'did:plc:bob', acct: 'bob.example.com', locked: false }

function post(over: Partial<Status> = {}, b: Partial<StatusBluesky> = {}): Status {
  return {
    id: POST_URI, content: '<p>hi</p>',
    favourited: false, favouritesCount: 3, reblogged: false, reblogsCount: 2, bookmarked: false,
    account: { id: 'did:plc:bob', username: 'bob', acct: 'bob.example.com' },
    bluesky: {
      uri: POST_URI, cid: 'bafy1', likeUri: null, repostUri: null, replyRef: null,
      replyDisabled: false, embeddingDisabled: false, labels: [],
      moderation: { contexts: {}, labelersCovered: [] }, viewerOf: ME, ...b,
    },
    ...over,
  } as unknown as Status
}

const ack = (on: boolean, record: string | null): StatusWriteAck => ({ ack: true, id: POST_URI, on, record })
const get = () => statusCache.value.get(POST_URI)!
const bsky = (impl: Partial<CaribouClient>) =>
  ({ clientSource: () => ({ userKey: ME, capabilities: { network: 'bluesky', readLagMs: 60_000 }, ...impl }) as CaribouClient })

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let toasts: string[]
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail.message)

beforeEach(() => {
  activeUserKey.value = ME
  ownerGeneration()
  forgetReaderFields()
  statusCache.value = new Map()
  relationshipCache.value = new Map()
  _testOnlyResetMutations()
  _testOnlyResetRelationships()
  toasts = []
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  activeUserKey.value = null
  ownerGeneration()
})

describe('status acks', () => {
  it('a like commits the flag and the like record; the count stays as the click left it', async () => {
    cacheStatus(post())
    const favourite = vi.fn(async (_ref: StatusRef) => ack(true, LIKE_URI))
    await toggleFavourite(get(), bsky({ favourite }))
    expect(get().favourited).toBe(true)
    expect(get().favouritesCount).toBe(4)
    expect(get().bluesky!.likeUri).toBe(LIKE_URI)
    expect(favourite.mock.calls[0]![0].bluesky).toMatchObject({ uri: POST_URI, cid: 'bafy1', likeUri: null })
  })

  it('the next undo sends the record the like made', async () => {
    cacheStatus(post())
    await toggleFavourite(get(), bsky({ favourite: async () => ack(true, LIKE_URI) }))
    const unfavourite = vi.fn(async (_ref: StatusRef) => ack(false, null))
    await toggleFavourite(get(), bsky({ unfavourite }))
    expect(unfavourite.mock.calls[0]![0].bluesky!.likeUri).toBe(LIKE_URI)
    expect(get().favourited).toBe(false)
    expect(get().favouritesCount).toBe(3)
    expect(get().bluesky!.likeUri).toBeNull()
  })

  it('a failed un-repost puts the flag, the count and the repost record back, with a toast', async () => {
    cacheStatus(post({ reblogged: true }, { repostUri: REPOST_URI }))
    await toggleReblog(get(), bsky({ unreblog: async () => { throw new Error('500') } }))
    expect(get().reblogged).toBe(true)
    expect(get().reblogsCount).toBe(2)
    expect(get().bluesky!.repostUri).toBe(REPOST_URI)
    expect(toasts).toHaveLength(1)
  })

  it('one click is one write: a second click while the like is out sends nothing', async () => {
    cacheStatus(post())
    const d = deferred<StatusWriteAck>()
    const favourite = vi.fn(() => d.promise)
    const first = toggleFavourite(get(), bsky({ favourite }))
    await toggleFavourite(get(), bsky({ favourite }))
    d.resolve(ack(true, LIKE_URI))
    await first
    expect(favourite).toHaveBeenCalledTimes(1)
  })

  it('an ack that lands after an account switch writes nothing', async () => {
    cacheStatus(post())
    const d = deferred<StatusWriteAck>()
    const p = toggleFavourite(get(), bsky({ favourite: () => d.promise }))
    ownerGeneration()
    activeUserKey.value = 'did:plc:other@bsky' as UserKey
    forgetReaderFields()
    const before = get()
    d.resolve(ack(true, LIKE_URI))
    await p
    expect(get()).toBe(before)
    expect(get().bluesky!.likeUri).toBeNull()
  })

  it('a bookmark ack sets only the flag', async () => {
    cacheStatus(post())
    await toggleBookmark(get(), bsky({ bookmark: async () => ack(true, null) }))
    expect(get().bookmarked).toBe(true)
    expect(get().bluesky!.likeUri).toBeNull()
  })
})

describe('relationship acks', () => {
  const key = relationshipKey(ME, BOB.id)
  const cached = () => relationshipCache.value.get(key)
  const rel = (over: Partial<Relationship> = {}) =>
    ({ id: BOB.id, following: false, followedBy: true, muting: false, blocking: false, requested: false,
      bluesky: { followUri: null, blockUri: null }, ...over }) as Relationship
  const seed = (r: Relationship) => { relationshipCache.value = new Map([[key, r]]) }

  it('a follow ack sets following and the follow record; other fields stay', async () => {
    seed(rel())
    const follow = vi.fn(async (): Promise<RelationshipWriteAck> =>
      ({ ack: true, id: BOB.id, flags: { following: true }, bluesky: { followUri: FOLLOW_URI } }))
    await toggleFollow(BOB, bsky({ follow }))
    expect(cached()).toMatchObject({ following: true, followedBy: true, bluesky: { followUri: FOLLOW_URI, blockUri: null } })
  })

  it('the unfollow after it names the follow record', async () => {
    seed(rel({ following: true, bluesky: { followUri: FOLLOW_URI, blockUri: null } }))
    const unfollow = vi.fn(async (): Promise<RelationshipWriteAck> =>
      ({ ack: true, id: BOB.id, flags: { following: false }, bluesky: { followUri: null } }))
    await toggleFollow(BOB, bsky({ unfollow }))
    expect(unfollow).toHaveBeenCalledWith({ id: BOB.id, bluesky: { followUri: FOLLOW_URI, blockUri: null } })
    expect(cached()).toMatchObject({ following: false, bluesky: { followUri: null } })
  })

  it('a block ack keeps the block record; an unblock names it', async () => {
    seed(rel())
    await setBlock(BOB, true, bsky({
      block: async () => ({ ack: true, id: BOB.id, flags: { blocking: true }, bluesky: { blockUri: BLOCK_URI } }),
    }))
    expect(cached()).toMatchObject({ blocking: true, bluesky: { blockUri: BLOCK_URI } })
    const unblock = vi.fn(async (): Promise<RelationshipWriteAck> =>
      ({ ack: true, id: BOB.id, flags: { blocking: false }, bluesky: { blockUri: null } }))
    await setBlock(BOB, false, bsky({ unblock }))
    expect(unblock).toHaveBeenCalledWith({ id: BOB.id, bluesky: { followUri: null, blockUri: BLOCK_URI } })
  })

  it('a failed mute rolls back with a toast', async () => {
    seed(rel())
    const ok = await setMute(BOB, true, bsky({ mute: async () => { throw new Error('500') } }))
    expect(ok).toBe(false)
    expect(cached()?.muting).toBe(false)
    expect(toasts).toHaveLength(1)
  })

  it('an ack with nothing cached builds the relationship from the ack', async () => {
    await setMute(BOB, true, bsky({
      mute: async () => ({ ack: true, id: BOB.id, flags: { muting: true, mutingNotifications: true } }),
    }))
    expect(cached()).toMatchObject({ id: BOB.id, muting: true, mutingNotifications: true })
  })
})
