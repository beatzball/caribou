import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, Relationship, RelationshipWriteAck } from '@beatzball/caribou-mastodon-client'
import { ownerGeneration } from '../keep-alive.js'
import {
  _testOnlyResetRelationships, loadRelationship, relationshipCache, relationshipKey, relationshipKnown,
  setBlock, setMute, toggleFollow,
} from '../relationships.js'
import { activeUserKey } from '../users.js'

// Relationship acks (README, "Bluesky acks" A1 to A3, and the group rule
// in "Viewer state"). The cases come from the PR #236 reviews.

const ME = 'did:plc:me@bsky' as UserKey
const BOB = { id: 'did:plc:bob', acct: 'bob.example.com', locked: false }
const F1 = 'at://did:plc:me/app.bsky.graph.follow/3f1'
const F2 = 'at://did:plc:me/app.bsky.graph.follow/3f2'
const B1 = 'at://did:plc:me/app.bsky.graph.block/3b1'
const B2 = 'at://did:plc:me/app.bsky.graph.block/3b2'
const LIST = 'at://did:plc:carol/app.bsky.graph.list/3l1'

const key = relationshipKey(ME, BOB.id)
const cached = () => relationshipCache.value.get(key)
const bsky = (impl: Partial<CaribouClient>) =>
  ({ clientSource: () => ({ userKey: ME, capabilities: { network: 'bluesky', readLagMs: 60_000 }, ...impl }) as CaribouClient })
// What the server says, as `mapRelationship` builds it.
const server = (over: Partial<Relationship> = {}, b: Partial<NonNullable<Relationship['bluesky']>> = {}) => ({
  id: BOB.id, following: false, followedBy: false, muting: false, mutingNotifications: false,
  blocking: false, blockedBy: false, requested: false,
  bluesky: { followUri: null, blockUri: null, blockingByList: null, mutingByList: null, ...b }, ...over,
}) as Relationship
const ack = (flags: RelationshipWriteAck['flags'], b?: RelationshipWriteAck['bluesky']): RelationshipWriteAck =>
  ({ ack: true, id: BOB.id, flags, ...(b ? { bluesky: b } : {}) })
const read = (rel: Relationship) => loadRelationship(BOB.id, bsky({ fetchRelationships: async () => [rel] }))

let toasts: string[]
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail.message)

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] })
  activeUserKey.value = ME
  ownerGeneration()
  relationshipCache.value = new Map()
  _testOnlyResetRelationships()
  toasts = []
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  vi.useRealTimers()
  window.removeEventListener('caribou:toast', onToast)
  activeUserKey.value = null
})

describe('A1: an ack is partial', () => {
  it('with nothing cached, a mute ack stores only the mute fields; following is unknown', async () => {
    await setMute(BOB, true, bsky({ mute: async () => ack({ muting: true, mutingNotifications: true }) }))
    expect(cached()).toEqual({ id: BOB.id, muting: true, mutingNotifications: true })
    expect(relationshipKnown(cached())).toBe(false)
  })

  it('card mute, then the profile read, then the button: the read fills following, and the click unfollows that record', async () => {
    await setMute(BOB, true, bsky({ mute: async () => ack({ muting: true, mutingNotifications: true }) }))
    await read(server({ following: true, followedBy: true, muting: true, mutingNotifications: true }, { followUri: F1 }))
    expect(cached()).toMatchObject({ following: true, followedBy: true, muting: true, bluesky: { followUri: F1 } })
    expect(relationshipKnown(cached())).toBe(true)
    const follow = vi.fn(async () => ack({ following: true }, { followUri: F2 }))
    const unfollow = vi.fn(async () => ack({ following: false }, { followUri: null }))
    await toggleFollow(BOB, bsky({ follow, unfollow }))
    expect(follow).not.toHaveBeenCalled()
    expect(unfollow).toHaveBeenCalledWith(expect.objectContaining({ bluesky: expect.objectContaining({ followUri: F1 }) }))
  })

  it('block then unblock with nothing cached: the read still fills the follow', async () => {
    await setBlock(BOB, true, bsky({ block: async () => ack({ blocking: true }, { blockUri: B1 }) }))
    await setBlock(BOB, false, bsky({ unblock: async () => ack({ blocking: false }, { blockUri: null }) }))
    expect(cached()!.following).toBeUndefined()
    expect(cached()!.bluesky!.followUri).toBeUndefined()
    await read(server({ following: true }, { followUri: F1 }))
    expect(cached()).toMatchObject({ following: true, blocking: false, bluesky: { followUri: F1, blockUri: null } })
  })

  it('toggleFollow does nothing while following is unknown', async () => {
    await setMute(BOB, true, bsky({ mute: async () => ack({ muting: true, mutingNotifications: true }) }))
    const follow = vi.fn(async () => ack({ following: true }, { followUri: F2 }))
    await toggleFollow(BOB, bsky({ follow }))
    expect(follow).not.toHaveBeenCalled()
  })
})

describe('A2: the lag guard compares the flag and its record URI', () => {
  it('follow, unfollow, follow: a lagging read naming the first record is refused, and the undo deletes the second', async () => {
    relationshipCache.value = new Map([[key, server()]])
    let n = 0
    const follow = vi.fn(async () => ack({ following: true }, { followUri: ++n === 1 ? F1 : F2 }))
    const unfollow = vi.fn(async () => ack({ following: false }, { followUri: null }))
    await toggleFollow(BOB, bsky({ follow, unfollow }))
    await toggleFollow(BOB, bsky({ follow, unfollow }))
    await toggleFollow(BOB, bsky({ follow, unfollow }))
    expect(cached()!.bluesky!.followUri).toBe(F2)
    await read(server({ following: true, followedBy: true }, { followUri: F1 }))
    expect(cached()!.bluesky!.followUri).toBe(F2)
    // Fields the write did not name come from the read.
    expect(cached()!.followedBy).toBe(true)
    await toggleFollow(BOB, bsky({ follow, unfollow }))
    expect(unfollow).toHaveBeenLastCalledWith(expect.objectContaining({ bluesky: expect.objectContaining({ followUri: F2 }) }))
  })

  it('block, unblock, block: a lagging read naming the first block is refused, and unblock deletes the second', async () => {
    relationshipCache.value = new Map([[key, server()]])
    let n = 0
    const block = vi.fn(async () => ack({ blocking: true }, { blockUri: ++n === 1 ? B1 : B2 }))
    const unblock = vi.fn(async () => ack({ blocking: false }, { blockUri: null }))
    await setBlock(BOB, true, bsky({ block }))
    await setBlock(BOB, false, bsky({ unblock }))
    await setBlock(BOB, true, bsky({ block }))
    await read(server({ blocking: true }, { blockUri: B1 }))
    expect(cached()!.bluesky!.blockUri).toBe(B2)
    await setBlock(BOB, false, bsky({ unblock }))
    expect(unblock).toHaveBeenLastCalledWith(expect.objectContaining({ bluesky: expect.objectContaining({ blockUri: B2 }) }))
  })

  it('after the lag window, the read wins', async () => {
    relationshipCache.value = new Map([[key, server()]])
    await toggleFollow(BOB, bsky({ follow: async () => ack({ following: true }, { followUri: F2 }) }))
    vi.setSystemTime(1_000_000 + 60_001)
    await read(server({ following: true }, { followUri: F1 }))
    expect(cached()!.bluesky!.followUri).toBe(F1)
  })

  it('a read that disagrees on one group still brings the others', async () => {
    relationshipCache.value = new Map([[key, server()]])
    await setMute(BOB, true, bsky({ mute: async () => ack({ muting: true, mutingNotifications: true }) }))
    await read(server({ muting: false, following: true, blockedBy: true }, { followUri: F1 }))
    expect(cached()).toMatchObject({ muting: true, following: true, blockedBy: true, bluesky: { followUri: F1 } })
  })
})

describe('A3: an undo never claims more than it removed', () => {
  it('Unblock of a list block sends nothing, keeps the block and says why', async () => {
    relationshipCache.value = new Map([[key, server({ blocking: true }, { blockingByList: LIST })]])
    const unblock = vi.fn(async () => ack({ blocking: false }, { blockUri: null }))
    expect(await setBlock(BOB, false, bsky({ unblock }))).toBe(false)
    expect(unblock).not.toHaveBeenCalled()
    expect(cached()!.blocking).toBe(true)
    expect(toasts).toEqual(['This block comes from a list. Remove the account from the list, or unsubscribe from it.'])
  })

  it('Unmute of a list mute sends nothing and says why', async () => {
    relationshipCache.value = new Map([[key, server({ muting: true, mutingNotifications: true }, { mutingByList: LIST })]])
    const unmute = vi.fn(async () => ack({ muting: false, mutingNotifications: false }))
    expect(await setMute(BOB, false, bsky({ unmute }))).toBe(false)
    expect(unmute).not.toHaveBeenCalled()
    expect(cached()!.muting).toBe(true)
    expect(toasts).toEqual(['This mute comes from a list. Remove the account from the list, or unsubscribe from it.'])
  })

  it('a client refusal shows its own message', async () => {
    relationshipCache.value = new Map([[key, server({ blocking: true })]])
    const refusal = Object.assign(new Error('list block'), { userMessage: 'This block comes from a list. Remove the account from the list, or unsubscribe from it.' })
    await setBlock(BOB, false, bsky({ unblock: async () => { throw refusal } }))
    expect(cached()!.blocking).toBe(true)
    expect(toasts).toEqual([refusal.userMessage])
  })
})

describe('N5: a Bluesky block leaves the follow', () => {
  it('the optimistic patch does not change following', async () => {
    relationshipCache.value = new Map([[key, server({ following: true }, { followUri: F1 })]])
    let answer!: (a: RelationshipWriteAck) => void
    const p = setBlock(BOB, true, bsky({ block: () => new Promise((r) => { answer = r }) }))
    expect(cached()).toMatchObject({ blocking: true, following: true })
    answer(ack({ blocking: true }, { blockUri: B1 }))
    await p
    expect(cached()).toMatchObject({ blocking: true, following: true, bluesky: { followUri: F1, blockUri: B1 } })
  })
})
