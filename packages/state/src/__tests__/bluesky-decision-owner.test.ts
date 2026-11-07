import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import type { Status, StatusBluesky } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, forgetReaderFields, mergeStatus, PAGE_DATA, readSource, statusCache } from '../caches.js'
import { ownerGeneration } from '../keep-alive.js'
import { activeUserKey } from '../users.js'

// README, "A Bluesky decision stays with its reader": `moderation` and
// `viewerOf` travel together through every merge.

const ME = 'did:plc:me@bsky' as UserKey
const OTHER = 'did:plc:other@bsky' as UserKey
const URI = 'at://did:plc:bob/app.bsky.feed.post/3k1'

// A decision that names whom it was made for, so a test can tell them apart.
const decision = (who: string) =>
  ({ contexts: {}, labelersCovered: [who] }) as unknown as StatusBluesky['moderation']

function post(viewerOf: UserKey | null, who: string): Status {
  return {
    id: URI, content: '<p>hi</p>', favourited: false, favouritesCount: 0,
    reblogged: false, reblogsCount: 0, bookmarked: false,
    account: { id: 'did:plc:bob', username: 'bob', acct: 'bob.example.com' },
    bluesky: {
      uri: URI, cid: 'bafy', likeUri: null, repostUri: null, replyRef: null,
      replyDisabled: false, embeddingDisabled: false, labels: [], moderation: decision(who), viewerOf,
    },
  } as unknown as Status
}

const cached = () => statusCache.value.get(URI)!.bluesky!

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] })
  activeUserKey.value = ME
  ownerGeneration()
  forgetReaderFields()
  statusCache.value = new Map()
})
afterEach(() => {
  vi.useRealTimers()
  activeUserKey.value = null
  ownerGeneration()
})

describe('a Bluesky decision stays with its reader', () => {
  it("the reader's copy keeps its own decision", () => {
    cacheStatus(post(ME, 'me'), readSource(ME))
    expect(cached()).toMatchObject({ viewerOf: ME, moderation: decision('me') })
  })

  it("page data over the reader's copy keeps the reader's viewerOf and the reader's decision", () => {
    cacheStatus(post(ME, 'me'), readSource(ME))
    mergeStatus(post(null, 'public'), PAGE_DATA)
    expect(cached()).toMatchObject({ viewerOf: ME, moderation: decision('me') })
  })

  it("another account's copy over the reader's keeps the reader's pair", () => {
    cacheStatus(post(ME, 'me'), readSource(ME))
    cacheStatus(post(OTHER, 'other'), readSource(OTHER))
    expect(cached()).toMatchObject({ viewerOf: ME, moderation: decision('me') })
  })

  it("another account's copy with nothing cached drops its decision with its viewerOf", () => {
    cacheStatus(post(OTHER, 'other'), readSource(OTHER))
    expect(cached().viewerOf).toBeNull()
    expect(cached().moderation).toBeUndefined()
  })

  it('an account change drops the decision with the viewerOf', () => {
    cacheStatus(post(ME, 'me'), readSource(ME))
    activeUserKey.value = null
    forgetReaderFields()
    expect(cached().viewerOf).toBeNull()
    expect(cached().moderation).toBeUndefined()
  })

  it('page data over page data takes the newer public decision', () => {
    activeUserKey.value = null
    mergeStatus(post(null, 'public-1'), PAGE_DATA)
    mergeStatus(post(null, 'public-2'), PAGE_DATA)
    expect(cached()).toMatchObject({ viewerOf: null, moderation: decision('public-2') })
  })
})
