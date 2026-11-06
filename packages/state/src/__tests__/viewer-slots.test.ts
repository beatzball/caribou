import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, Status, StatusBluesky, StatusRef } from '@beatzball/caribou-mastodon-client'
import {
  cacheStatus, forgetReaderFields, mergeStatus, PAGE_DATA, readSource, statusCache, updateStatus,
} from '../caches.js'
import { createProfileStore } from '../profile-store.js'
import { ownerGeneration } from '../keep-alive.js'
import { _testOnlyResetMutations, toggleBookmark, toggleFavourite, toggleReblog } from '../mutations.js'
import { activeUserKey } from '../users.js'

// Seam 4 (spec 6.3) and the rules in the package README, "Viewer state:
// slots and who wins". Each test names the rule it checks.

const ME = 'did:plc:me@bsky' as UserKey
const OTHER = 'did:plc:other@bsky' as UserKey
const POST_URI = 'at://did:plc:bob/app.bsky.feed.post/3k1'
const LIKE_URI = 'at://did:plc:me/app.bsky.feed.like/3l1'
const LIKE_URI_2 = 'at://did:plc:me/app.bsky.feed.like/3l2'
const REPOST_URI = 'at://did:plc:me/app.bsky.feed.repost/3r1'
const REPOST_URI_2 = 'at://did:plc:me/app.bsky.feed.repost/3r2'

function bsky(over: Partial<StatusBluesky> = {}): StatusBluesky {
  return {
    uri: POST_URI, cid: 'bafy1', likeUri: null, repostUri: null,
    replyRef: null, replyDisabled: false, embeddingDisabled: false,
    labels: [], moderation: { contexts: {}, labelersCovered: [] } as unknown as StatusBluesky['moderation'],
    viewerOf: ME,
    ...over,
  }
}

function post(over: Partial<Status> = {}, b: Partial<StatusBluesky> = {}): Status {
  return {
    id: POST_URI, content: '<p>hi</p>',
    favourited: false, favouritesCount: 0,
    reblogged: false, reblogsCount: 0, bookmarked: false,
    account: { id: 'did:plc:bob', username: 'bob', acct: 'bob.example.com' },
    bluesky: bsky(b),
    ...over,
  } as unknown as Status
}

const liked = (uri = LIKE_URI, count = 1) =>
  post({ favourited: true, favouritesCount: count }, { likeUri: uri })
const reposted = (uri = REPOST_URI) => post({ reblogged: true, reblogsCount: 1 }, { repostUri: uri })

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const get = () => statusCache.value.get(POST_URI)!
// A Bluesky client: its reads can lag 60 s behind a write.
const client = (impl: Partial<CaribouClient>, readLagMs = 60_000) =>
  ({ clientSource: () => ({ capabilities: { readLagMs }, ...impl }) as CaribouClient })

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] })
  activeUserKey.value = ME
  ownerGeneration()
  forgetReaderFields()
  statusCache.value = new Map()
  _testOnlyResetMutations()
})
afterEach(() => {
  vi.useRealTimers()
  activeUserKey.value = null
  ownerGeneration()
})

describe('rule 3: a fetch that started before the write finished', () => {
  it('refetch starts, like succeeds, old refetch lands: the like and its likeUri stay, undo deletes it', async () => {
    cacheStatus(post(), readSource(ME))
    const refetch = readSource(ME)
    await toggleFavourite(get(), client({ favourite: async () => liked() }))
    cacheStatus(post(), refetch)
    expect(get().favourited).toBe(true)
    expect(get().bluesky!.likeUri).toBe(LIKE_URI)
    expect(get().favouritesCount).toBe(1)

    const sent: StatusRef[] = []
    await toggleFavourite(get(), client({ unfavourite: async (ref) => { sent.push(ref); return post() } }))
    expect(sent[0]!.bluesky!.likeUri).toBe(LIKE_URI)
    expect(get().favourited).toBe(false)
  })

  it('the same through mergeStatus (a reader-view refetch)', async () => {
    cacheStatus(post(), readSource(ME))
    const refetch = readSource(ME)
    await toggleFavourite(get(), client({ favourite: async () => liked() }))
    mergeStatus(post(), refetch)
    expect(get().favourited).toBe(true)
    expect(get().bluesky!.likeUri).toBe(LIKE_URI)
  })

  it('unlike: an old refetch that still says liked does not bring the like back', async () => {
    cacheStatus(liked(), readSource(ME))
    const refetch = readSource(ME)
    await toggleFavourite(get(), client({ unfavourite: async () => post() }))
    cacheStatus(liked(), refetch)
    expect(get().favourited).toBe(false)
    expect(get().bluesky!.likeUri).toBeNull()

    const calls: string[] = []
    await toggleFavourite(get(), client({ favourite: async () => { calls.push('favourite'); return liked(LIKE_URI_2) } }))
    expect(calls).toEqual(['favourite'])
    expect(get().bluesky!.likeUri).toBe(LIKE_URI_2)
  })

  it('repost: an old refetch does not erase it, and undo deletes the right record', async () => {
    cacheStatus(post(), readSource(ME))
    const refetch = readSource(ME)
    await toggleReblog(get(), client({ reblog: async () => reposted() }))
    cacheStatus(post(), refetch)
    expect(get().reblogged).toBe(true)
    expect(get().bluesky!.repostUri).toBe(REPOST_URI)

    const sent: StatusRef[] = []
    await toggleReblog(get(), client({ unreblog: async (ref) => { sent.push(ref); return post() } }))
    expect(sent[0]!.bluesky!.repostUri).toBe(REPOST_URI)
  })

  it('un-repost: an old refetch does not bring the repost back', async () => {
    cacheStatus(reposted(), readSource(ME))
    const refetch = readSource(ME)
    await toggleReblog(get(), client({ unreblog: async () => post() }))
    cacheStatus(reposted(), refetch)
    expect(get().reblogged).toBe(false)
    expect(get().bluesky!.repostUri).toBeNull()
  })

  it('a refetch that started after the write finished is taken', async () => {
    cacheStatus(post(), readSource(ME))
    await toggleFavourite(get(), client({ favourite: async () => liked() }))
    // Agrees with the write: taken at once, count and all.
    cacheStatus(liked(LIKE_URI, 5), readSource(ME))
    expect(get().favouritesCount).toBe(5)
  })
})

describe('rule 2: a slot with a write out', () => {
  it('a like in flight is not overwritten; a repost result in the same copy is taken', async () => {
    cacheStatus(post(), readSource(ME))
    const like = deferred<Status>()
    const p = toggleFavourite(get(), client({ favourite: () => like.promise }))
    await toggleReblog(get(), client({ reblog: async () => reposted() }))
    // A fetch after the repost finished, before the like answered.
    cacheStatus(post({ reblogged: true, reblogsCount: 1 }, { repostUri: REPOST_URI }), readSource(ME))
    expect(get().favourited).toBe(true)
    expect(get().reblogged).toBe(true)
    expect(get().bluesky!.repostUri).toBe(REPOST_URI)

    like.resolve(post({ favourited: true, favouritesCount: 1, reblogged: true, reblogsCount: 1 },
      { likeUri: LIKE_URI, repostUri: REPOST_URI }))
    await p
    expect(get().bluesky!.likeUri).toBe(LIKE_URI)
    expect(get().bluesky!.repostUri).toBe(REPOST_URI)
  })

  it('a like and a repost at the same time both land', async () => {
    cacheStatus(post(), readSource(ME))
    const like = deferred<Status>()
    const rp = deferred<Status>()
    const c = client({ favourite: () => like.promise, reblog: () => rp.promise })
    const p1 = toggleFavourite(get(), c)
    const p2 = toggleReblog(get(), c)
    const refetch = readSource(ME)
    rp.resolve(reposted())
    await p2
    like.resolve(liked())
    await p1
    cacheStatus(post(), refetch)
    expect([get().favourited, get().bluesky!.likeUri]).toEqual([true, LIKE_URI])
    expect([get().reblogged, get().bluesky!.repostUri]).toEqual([true, REPOST_URI])
  })

  it('bookmark is a slot too', async () => {
    cacheStatus(post(), readSource(ME))
    const refetch = readSource(ME)
    await toggleBookmark(get(), client({ bookmark: async () => post({ bookmarked: true }) }))
    cacheStatus(post(), refetch)
    expect(get().bookmarked).toBe(true)
  })
})

describe('rule 4: the AppView lag window', () => {
  it('inside 60 s a fresh fetch that disagrees is ignored; after it, the fetch wins', async () => {
    cacheStatus(post(), readSource(ME))
    await toggleFavourite(get(), client({ favourite: async () => liked() }))

    vi.setSystemTime(1_000_000 + 30_000)
    cacheStatus(post(), readSource(ME))
    expect(get().favourited).toBe(true)
    expect(get().bluesky!.likeUri).toBe(LIKE_URI)
    expect(get().favouritesCount).toBe(1)

    vi.setSystemTime(1_000_000 + 60_001)
    cacheStatus(post(), readSource(ME))
    expect(get().favourited).toBe(false)
    expect(get().bluesky!.likeUri).toBeNull()
  })

  it('inside 60 s a fresh fetch that agrees is taken', async () => {
    cacheStatus(post(), readSource(ME))
    await toggleFavourite(get(), client({ favourite: async () => liked() }))
    vi.setSystemTime(1_000_000 + 5_000)
    cacheStatus(liked(LIKE_URI, 3), readSource(ME))
    expect(get().favouritesCount).toBe(3)
  })
})

describe('rule 1: only the reader\'s copy writes viewer state', () => {
  it('signed-out SSR copy first, then the owner\'s refetch fills the slots', () => {
    mergeStatus(post({}, { viewerOf: null }))
    expect(get().favourited).toBe(false)
    mergeStatus(post({ favourited: true, reblogged: true, bookmarked: true }, {
      likeUri: LIKE_URI, repostUri: REPOST_URI, replyDisabled: true,
    }), readSource(ME))
    expect(get().favourited).toBe(true)
    expect(get().reblogged).toBe(true)
    expect(get().bookmarked).toBe(true)
    expect(get().bluesky!.likeUri).toBe(LIKE_URI)
    expect(get().bluesky!.replyDisabled).toBe(true)
    expect(get().bluesky!.viewerOf).toBe(ME)
  })

  it('page data after the owner\'s copy keeps the viewer fields', () => {
    cacheStatus(liked(), readSource(ME))
    mergeStatus(post({ content: '<p>edited</p>' }, { viewerOf: null }), PAGE_DATA)
    expect(get().content).toBe('<p>edited</p>')
    expect(get().favourited).toBe(true)
    expect(get().bluesky!.likeUri).toBe(LIKE_URI)
    expect(get().bluesky!.viewerOf).toBe(ME)
  })

  it('a copy whose viewerOf names another account does not write', () => {
    cacheStatus(post(), readSource(ME))
    cacheStatus(post({ favourited: true }, { likeUri: LIKE_URI, viewerOf: OTHER }), readSource(ME))
    expect(get().favourited).toBe(false)
    expect(get().bluesky!.likeUri).toBeNull()
  })

  it('another account\'s copy after an account change adds no viewer state', () => {
    cacheStatus(post(), readSource(ME))
    forgetReaderFields()
    cacheStatus(post({ favourited: true }, { likeUri: LIKE_URI, viewerOf: OTHER }), readSource(OTHER))
    expect(get().favourited).toBeFalsy()
    expect(get().bluesky!.likeUri).toBeNull()
  })

  it('another account\'s copy with nothing cached comes in without viewer state', () => {
    cacheStatus(post({ favourited: true, bookmarked: true }, { likeUri: LIKE_URI, viewerOf: OTHER }), readSource(OTHER))
    expect(get().favourited).toBeFalsy()
    expect(get().bookmarked).toBeFalsy()
    expect(get().bluesky!.likeUri).toBeNull()
    expect(get().bluesky!.viewerOf).toBeNull()
  })

  it('a fetch that answers after an account change is not the reader\'s copy', () => {
    cacheStatus(post(), readSource(ME))
    const started = readSource(ME)
    activeUserKey.value = OTHER
    ownerGeneration()
    cacheStatus(post(), readSource(OTHER))
    cacheStatus(liked(), started)
    expect(get().favourited).toBeFalsy()
  })
})

describe('Mastodon posts follow the same rule', () => {
  const MASTO = 'alice@example.social' as UserKey
  const toot = (over: Partial<Status> = {}) => ({
    id: '1', content: '<p>1</p>', favourited: false, favouritesCount: 0,
    account: { id: 'a1', username: 'bob', acct: 'bob' }, ...over,
  }) as unknown as Status

  it('an old refetch does not erase a favourite', async () => {
    activeUserKey.value = MASTO
    ownerGeneration()
    cacheStatus(toot(), readSource(MASTO))
    const refetch = readSource(MASTO)
    await toggleFavourite(statusCache.value.get('1')!,
      client({ favourite: async () => toot({ favourited: true, favouritesCount: 1 }) }, 0))
    cacheStatus(toot(), refetch)
    expect(statusCache.value.get('1')!.favourited).toBe(true)
    expect(statusCache.value.get('1')!.favouritesCount).toBe(1)
  })

  it('has no lag window: a fresh fetch that disagrees right after a write wins', async () => {
    activeUserKey.value = MASTO
    ownerGeneration()
    cacheStatus(toot(), readSource(MASTO))
    await toggleFavourite(statusCache.value.get('1')!,
      client({ favourite: async () => toot({ favourited: true, favouritesCount: 1 }) }, 0))
    cacheStatus(toot(), readSource(MASTO))
    expect(statusCache.value.get('1')!.favourited).toBe(false)
  })
})

describe('rule 4: agreement is the flag and the record ref', () => {
  it('like, unlike, like: an in-window copy with the first, deleted like does not replace the new one', async () => {
    cacheStatus(post(), readSource(ME))
    await toggleFavourite(get(), client({ favourite: async () => liked(LIKE_URI) }))
    await toggleFavourite(get(), client({ unfavourite: async () => post() }))
    await toggleFavourite(get(), client({ favourite: async () => liked(LIKE_URI_2) }))
    vi.setSystemTime(1_000_000 + 5_000)
    // The AppView still shows the first like: same flag, deleted record.
    cacheStatus(liked(LIKE_URI, 7), readSource(ME))
    expect(get().bluesky!.likeUri).toBe(LIKE_URI_2)
    // Both say liked: the count is the copy's.
    expect(get().favouritesCount).toBe(7)

    const sent: StatusRef[] = []
    await toggleFavourite(get(), client({ unfavourite: async (ref) => { sent.push(ref); return post() } }))
    expect(sent[0]!.bluesky!.likeUri).toBe(LIKE_URI_2)
  })

  it('repost, unrepost, repost: the same for the repost record', async () => {
    cacheStatus(post(), readSource(ME))
    await toggleReblog(get(), client({ reblog: async () => reposted(REPOST_URI) }))
    await toggleReblog(get(), client({ unreblog: async () => post() }))
    await toggleReblog(get(), client({ reblog: async () => reposted(REPOST_URI_2) }))
    vi.setSystemTime(1_000_000 + 5_000)
    cacheStatus(reposted(REPOST_URI), readSource(ME))
    expect(get().bluesky!.repostUri).toBe(REPOST_URI_2)

    const sent: StatusRef[] = []
    await toggleReblog(get(), client({ unreblog: async (ref) => { sent.push(ref); return post() } }))
    expect(sent[0]!.bluesky!.repostUri).toBe(REPOST_URI_2)
  })

  it('a copy with the new record agrees and is taken, count and all', async () => {
    cacheStatus(post(), readSource(ME))
    await toggleFavourite(get(), client({ favourite: async () => liked(LIKE_URI) }))
    await toggleFavourite(get(), client({ unfavourite: async () => post() }))
    await toggleFavourite(get(), client({ favourite: async () => liked(LIKE_URI_2) }))
    vi.setSystemTime(1_000_000 + 5_000)
    cacheStatus(liked(LIKE_URI_2, 7), readSource(ME))
    expect(get().favouritesCount).toBe(7)
  })
})

describe('the count goes with the slot', () => {
  it('a kept like: the copy\'s count plus the reader\'s like, which the copy lacks', async () => {
    cacheStatus(post(), readSource(ME))
    await toggleFavourite(get(), client({ favourite: async () => liked() }))
    vi.setSystemTime(1_000_000 + 30_000)
    cacheStatus(post({ favouritesCount: 7 }), readSource(ME))
    expect(get().favourited).toBe(true)
    expect(get().favouritesCount).toBe(8)
  })
})

describe('a write still out across an account switch', () => {
  it('leaves no slot written to: the new account\'s copy is taken', async () => {
    cacheStatus(post(), readSource(ME))
    const like = deferred<Status>()
    const p = toggleFavourite(get(), client({ favourite: () => like.promise }))
    activeUserKey.value = OTHER
    ownerGeneration()
    like.resolve(liked())
    await p
    cacheStatus(post({ favourited: true, favouritesCount: 4 }, { likeUri: LIKE_URI_2, viewerOf: OTHER }), readSource(OTHER))
    expect(get().favourited).toBe(true)
    expect(get().bluesky!.likeUri).toBe(LIKE_URI_2)
    expect(get().favouritesCount).toBe(4)
  })
})

describe('rollback records the flag and ref the post ended with', () => {
  it('a failed unlike after a newer like landed: the slot holds the newer like', async () => {
    cacheStatus(liked(LIKE_URI), readSource(ME))
    const unlike = deferred<Status>()
    const p = toggleFavourite(get(), client({ unfavourite: () => unlike.promise }))
    // A newer write set the slot from the server while the unlike was out.
    updateStatus(POST_URI, { favourited: true, bluesky: { ...get().bluesky!, likeUri: LIKE_URI_2 } })
    unlike.reject(new Error('fail'))
    await p
    expect(get().bluesky!.likeUri).toBe(LIKE_URI_2)
    vi.setSystemTime(1_000_000 + 5_000)
    // A lagging copy with the first like: it does not agree with what the
    // post ended with, so the newer like stays.
    cacheStatus(liked(LIKE_URI), readSource(ME))
    expect(get().bluesky!.likeUri).toBe(LIKE_URI_2)
  })
})

describe('viewer fields are removed together', () => {
  const restricted = () => post({ favourited: true, muted: true, pinned: true } as Partial<Status>,
    { likeUri: LIKE_URI, replyDisabled: true, embeddingDisabled: true })

  it('an account change clears every viewer field, nested posts too', () => {
    cacheStatus(restricted(), readSource(ME))
    const wrapper = { ...post(), id: 'wrap', reblog: restricted() } as Status
    cacheStatus(wrapper, readSource(ME))
    forgetReaderFields()
    for (const s of [get(), statusCache.value.get('wrap')!.reblog!]) {
      expect(s.favourited).toBeUndefined()
      expect(s.muted).toBeUndefined()
      expect(s.pinned).toBeUndefined()
      expect(s.bluesky).toMatchObject({
        likeUri: null, repostUri: null, viewerOf: null, replyDisabled: false, embeddingDisabled: false,
      })
    }
  })

  it('another account\'s copy with nothing cached comes in with every viewer field cleared', () => {
    cacheStatus({ ...restricted(), bluesky: { ...restricted().bluesky!, viewerOf: OTHER } }, readSource(OTHER))
    expect(get().bluesky).toMatchObject({
      likeUri: null, viewerOf: null, replyDisabled: false, embeddingDisabled: false,
    })
    expect(get().muted).toBeUndefined()
  })
})

describe('Mastodon: another owner\'s copy, and counts at zero lag', () => {
  const MASTO = 'alice@example.social' as UserKey
  const BOB = 'bob@example.social' as UserKey
  const toot = (over: Partial<Status> = {}) => ({
    id: '1', uri: 'https://example.social/users/author/statuses/1', content: '<p>1</p>',
    favouritesCount: 0, account: { id: 'author', username: 'author', acct: 'author' }, ...over,
  }) as unknown as Status
  const cached = () => statusCache.value.get('1')!

  beforeEach(() => {
    activeUserKey.value = MASTO
    ownerGeneration()
  })

  it('page data with no flags, then the reader\'s copy merged with no source: the true flags stay', () => {
    mergeStatus(toot({ favouritesCount: 1 }))
    mergeStatus(toot({ favourited: true, bookmarked: true, favouritesCount: 1, filtered: [] }))
    expect(cached().favourited).toBe(true)
    expect(cached().bookmarked).toBe(true)
  })

  it('a profile page that answers after an account change brings no viewer state, with nothing cached', async () => {
    const page = deferred<Status[]>()
    const store = createProfileStore('author', 'posts', {
      clientSource: () => ({
        userKey: MASTO, capabilities: { readLagMs: 0 },
        fetchAccountStatuses: () => page.promise.then((xs) => Object.assign(xs, { nextCursor: null })),
      }) as unknown as CaribouClient,
    })
    const loading = store.load()
    activeUserKey.value = BOB
    ownerGeneration()
    page.resolve([toot({ favourited: true, bookmarked: true, muted: true, pinned: true } as Partial<Status>)])
    await loading
    expect(cached().favourited).toBeUndefined()
    expect(cached().bookmarked).toBeUndefined()
    expect(cached().muted).toBeUndefined()
    expect(cached().pinned).toBeUndefined()
  })

  for (const via of ['mergeStatus', 'cacheStatus'] as const) {
    const put = (s: Status) => via === 'mergeStatus' ? mergeStatus(s, readSource(MASTO)) : cacheStatus(s, readSource(MASTO))

    it(`${via}: an accepted unlike brings its count`, () => {
      put(toot({ favourited: true, favouritesCount: 5 }))
      put(toot({ favourited: false, favouritesCount: 4 }))
      expect([cached().favourited, cached().favouritesCount]).toEqual([false, 4])
    })

    it(`${via}: an accepted unreblog brings its count`, () => {
      put(toot({ reblogged: true, reblogsCount: 5 }))
      put(toot({ reblogged: false, reblogsCount: 4 }))
      expect([cached().reblogged, cached().reblogsCount]).toEqual([false, 4])
    })

    it(`${via}: after the reader's own unlike at zero lag, the server's copy wins with its count`, async () => {
      put(toot({ favourited: true, favouritesCount: 5 }))
      await toggleFavourite(cached(), client({ unfavourite: async () => toot({ favourited: false, favouritesCount: 4 }) }, 0))
      put(toot({ favourited: false, favouritesCount: 3 }))
      expect([cached().favourited, cached().favouritesCount]).toEqual([false, 3])
    })
  }
})
