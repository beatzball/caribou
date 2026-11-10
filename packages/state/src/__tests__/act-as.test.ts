import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  CaribouError, type CaribouClient, type Capabilities, type Status, type StatusBluesky,
} from '@beatzball/caribou-mastodon-client'
import { users, activeUserKey, markExpired, saveToStorage, type BlueskySession, type UserSession } from '../users.js'
import { setBlueskyDriver, blueskyRestore, blueskyUserKey, type BlueskyDriver } from '../bluesky-session.js'
import { cacheStatus, statusCache } from '../caches.js'
import { readSource } from '../viewer-slots.js'
import { actAs, actAsAccounts, readAsAccount, _testOnlyResetActAs, type ActAsView } from '../act-as.js'

// README, "Act as another account". Each test names the rule it checks.

const CAPS = { network: 'bluesky', readLagMs: 60_000 } as unknown as Capabilities
const ALICE = blueskyUserKey('did:plc:alice')
const BOB = blueskyUserKey('did:plc:bob')
const CAROL = blueskyUserKey('did:plc:carol')
const MASTO = toUserKey('dave', 'example.social')
const POST = 'at://did:plc:erin/app.bsky.feed.post/3kpost'
const BOB_LIKE = 'at://did:plc:bob/app.bsky.feed.like/3klike'

function bsky(did: string, over: Partial<BlueskySession> = {}): BlueskySession {
  return {
    network: 'bluesky', userKey: blueskyUserKey(did), did, handle: `${did.slice(8)}.example.com`,
    pds: `https://${did.slice(8)}.pds.example.test`, generation: `G-${did}`, account: null, createdAt: 1, ...over,
  }
}

function masto(): UserSession {
  return { userKey: MASTO, server: 'example.social', token: 'T', vapidKey: 'V', generation: 'M1', account: null, createdAt: 1 }
}

function signIn(...sessions: UserSession[]) {
  users.value = new Map(sessions.map((s) => [s.userKey, s]))
  saveToStorage()
}

function post(over: Partial<StatusBluesky> = {}, top: Partial<Status> = {}): Status {
  return {
    id: POST, content: '<p>hi</p>', visibility: 'public', createdAt: '2026-11-01T00:00:00Z',
    account: { id: 'did:plc:erin', acct: 'erin.example.com', username: 'erin' },
    favourited: false, favouritesCount: 3, reblogged: false, reblogsCount: 1, bookmarked: false, repliesCount: 0,
    bluesky: {
      uri: POST, cid: 'bafypost', likeUri: null, repostUri: null, replyRef: null,
      replyDisabled: false, embeddingDisabled: false, labels: [], viewerOf: ALICE, ...over,
    },
    ...top,
  } as unknown as Status
}

const VIEW: ActAsView = { favourited: false, reblogged: false, bookmarked: false, likeUri: null, repostUri: null }

interface Fake { userKey: string; client: Record<string, ReturnType<typeof vi.fn>>; expire: () => void }

function setup() {
  const made: Fake[] = []
  const restore = vi.fn(async (session: BlueskySession, hooks: { onExpired(): void }) => {
    const client = {
      userKey: session.userKey, capabilities: CAPS, timelineOrder: () => null,
      fetchStatus: vi.fn(async () => post({ likeUri: BOB_LIKE, viewerOf: session.userKey }, { favourited: true })),
      favourite: vi.fn(async (ref: { id: string }) => ({ ack: true, id: ref.id, on: true, record: BOB_LIKE })),
      unfavourite: vi.fn(async (ref: { id: string }) => ({ ack: true, id: ref.id, on: false, record: null })),
      reblog: vi.fn(async (ref: { id: string }) => ({ ack: true, id: ref.id, on: true, record: 'at://did:plc:bob/app.bsky.feed.repost/3kr' })),
      bookmark: vi.fn(async (ref: { id: string }) => ({ ack: true, id: ref.id, on: true, record: null })),
    } as unknown as Fake['client']
    // As the real client does on a 401: the hook first, then the error.
    made.push({ userKey: session.userKey, client, expire: () => hooks.onExpired() })
    return client as unknown as CaribouClient
  })
  const driver = { capabilities: CAPS, timelineOrder: () => null, restore, signOut: vi.fn() } as unknown as BlueskyDriver
  setBlueskyDriver(driver)
  return { restore, made }
}

let expired: unknown[] = []
const onExpired = (e: Event) => {
  const d = (e as CustomEvent<{ userKey: string; generation: string }>).detail
  expired.push(d)
  markExpired(d.userKey as never, d.generation)
}

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  statusCache.value = new Map()
  localStorage.clear()
  setBlueskyDriver(null)
  blueskyRestore.value = 'idle'
  _testOnlyResetActAs()
  expired = []
  window.addEventListener('caribou:session-expired', onExpired)
})
afterEach(() => {
  window.removeEventListener('caribou:session-expired', onExpired)
  vi.restoreAllMocks()
})

describe('rule 1: the picker lists only accounts on the post network', () => {
  it('a Bluesky post lists the other Bluesky accounts, not the active one, not a Mastodon one', () => {
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'), masto(), bsky('did:plc:carol', { expired: true }))
    activeUserKey.value = ALICE
    expect(actAsAccounts(post()).map((u) => u.userKey)).toEqual([BOB, CAROL])
  })

  it('a Mastodon active account sees the Bluesky accounts for a Bluesky post', () => {
    signIn(masto(), bsky('did:plc:bob'))
    activeUserKey.value = MASTO
    expect(actAsAccounts(post()).map((u) => u.userKey)).toEqual([BOB])
  })

  it('a boost wrapper lists by the post it boosts', () => {
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    const wrapper = { ...post(), id: 'repost:x', bluesky: undefined, reblog: post() } as unknown as Status
    expect(actAsAccounts(wrapper).map((u) => u.userKey)).toEqual([BOB])
  })

  it('a Mastodon post lists no account yet (#131)', () => {
    signIn(masto(), { ...masto(), userKey: toUserKey('frank', 'example.social') }, bsky('did:plc:bob'))
    activeUserKey.value = MASTO
    const m = { ...post(), id: '7', bluesky: undefined } as unknown as Status
    expect(actAsAccounts(m)).toEqual([])
  })

  it('signed out: no account to act as', () => {
    expect(actAsAccounts(post())).toEqual([])
  })
})

describe('rules 2 and 3: the write goes through the other account, with the AT URI as is', () => {
  it('a like as bob restores bob session and sends the post URI and CID unchanged', async () => {
    const { restore, made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    const out = await actAs(BOB, 'favourite', post(), VIEW)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(restore.mock.calls[0]![0]).toMatchObject({ did: 'did:plc:bob', pds: 'https://bob.pds.example.test' })
    expect(made[0]!.userKey).toBe(BOB)
    expect(made[0]!.client.favourite).toHaveBeenCalledWith({
      id: POST, bluesky: { uri: POST, cid: 'bafypost', likeUri: null, repostUri: null },
    })
    expect(out).toEqual({ kind: 'ok', view: { ...VIEW, favourited: true, likeUri: BOB_LIKE } })
  })

  it('an undo deletes the record of the other account view, not the active one', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    const mine = post({ likeUri: 'at://did:plc:alice/app.bsky.feed.like/3kmine' }, { favourited: true })
    const out = await actAs(BOB, 'favourite', mine, { ...VIEW, favourited: true, likeUri: BOB_LIKE })
    expect(made[0]!.client.unfavourite).toHaveBeenCalledWith({
      id: POST, bluesky: { uri: POST, cid: 'bafypost', likeUri: BOB_LIKE, repostUri: null },
    })
    expect(out).toEqual({ kind: 'ok', view: { ...VIEW } })
  })

  it('the restore of the other account shows no splash', async () => {
    setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    expect(blueskyRestore.value).toBe('idle')
  })
})

describe('rule 4: the other account view stays out of the cache', () => {
  it('readAsAccount answers bob flags and refs and caches nothing', async () => {
    setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    expect(await readAsAccount(BOB, post())).toEqual({ kind: 'ok', view: { ...VIEW, favourited: true, likeUri: BOB_LIKE } })
    expect(statusCache.value.size).toBe(0)
  })

  it('a like as bob changes no flag, ref or count of the active reader', async () => {
    setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    cacheStatus(post())
    const before = statusCache.value.get(POST)
    await actAs(BOB, 'favourite', post(), VIEW)
    await actAs(BOB, 'reblog', post(), VIEW)
    await actAs(BOB, 'bookmark', post(), VIEW)
    expect(statusCache.value.get(POST)).toBe(before)
  })

  it('a copy that bob client read, if cached, does not set the reader flags (viewerOf)', () => {
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    cacheStatus(post())
    cacheStatus(post({ likeUri: BOB_LIKE, viewerOf: BOB }, { favourited: true }), readSource(BOB))
    const cached = statusCache.value.get(POST)!
    expect(cached.favourited).toBe(false)
    expect(cached.bluesky!.likeUri).toBeNull()
    expect(cached.bluesky!.viewerOf).toBe(ALICE)
  })
})

describe('rule 5: an expired account does not write', () => {
  it('a session marked expired sends nothing and says expired', async () => {
    const { restore } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob', { expired: true }))
    activeUserKey.value = ALICE
    expect(await actAs(BOB, 'favourite', post(), VIEW)).toEqual({ kind: 'expired' })
    expect(await readAsAccount(BOB, post())).toEqual({ kind: 'expired' })
    expect(restore).not.toHaveBeenCalled()
  })

  it('a session the server calls gone is marked expired, for its own sign-in', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    made[0]!.client.favourite!.mockImplementationOnce(async () => {
      made[0]!.expire()
      throw new CaribouError('unauthorized', 'gone')
    })
    expect(await actAs(BOB, 'favourite', post(), VIEW)).toEqual({ kind: 'expired' })
    expect(expired).toEqual([{ userKey: BOB, generation: 'G-did:plc:bob' }])
    expect(users.value.get(BOB)!.expired).toBe(true)
    expect(users.value.get(ALICE)!.expired).toBeUndefined()
    // Expired now: the next try sends nothing.
    made[0]!.client.favourite!.mockClear()
    expect(await actAs(BOB, 'favourite', post(), VIEW)).toEqual({ kind: 'expired' })
    expect(made[0]!.client.favourite).not.toHaveBeenCalled()
  })

  it('an account that is not signed in is not acted as', async () => {
    const { restore } = setup()
    signIn(bsky('did:plc:alice'))
    activeUserKey.value = ALICE
    expect(await actAs(BOB, 'favourite', post(), VIEW)).toMatchObject({ kind: 'failed' })
    expect(restore).not.toHaveBeenCalled()
  })

  it('the active account is not acted as through this path', async () => {
    const { restore } = setup()
    signIn(bsky('did:plc:alice'))
    activeUserKey.value = ALICE
    expect(await actAs(ALICE, 'favourite', post(), VIEW)).toMatchObject({ kind: 'failed' })
    expect(restore).not.toHaveBeenCalled()
  })
})

describe('rule 6: one write per account, action and post', () => {
  it('a second click while the first is out sends nothing', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    let release!: () => void
    made[0]!.client.favourite!.mockImplementationOnce(() => new Promise((r) => {
      release = () => r({ ack: true, id: POST, on: true, record: BOB_LIKE })
    }))
    const first = actAs(BOB, 'favourite', post(), VIEW)
    expect(await actAs(BOB, 'favourite', post(), VIEW)).toEqual({ kind: 'busy' })
    // Another action is its own write.
    expect(await actAs(BOB, 'bookmark', post(), VIEW)).toMatchObject({ kind: 'ok' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    expect(await first).toMatchObject({ kind: 'ok' })
    expect(made[0]!.client.favourite).toHaveBeenCalledTimes(1)
  })
})

describe('rule 7: every answer is true', () => {
  it('a failed write answers failed with a message, and the session stays', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    made[0]!.client.reblog!.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    expect(await actAs(BOB, 'reblog', post(), VIEW)).toEqual({
      kind: 'failed', message: 'Could not boost this post as @bob.example.com. Try again.',
    })
    expect(users.value.get(BOB)!.expired).toBeUndefined()
  })

  it('a failed read answers failed', async () => {
    const { restore } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    restore.mockImplementationOnce(async (s: BlueskySession) => ({
      userKey: s.userKey, capabilities: CAPS, timelineOrder: () => null,
      fetchStatus: async () => { throw new CaribouError('unreachable', 'offline') },
    }) as unknown as CaribouClient)
    expect(await readAsAccount(BOB, post())).toEqual({
      kind: 'failed', message: 'Could not load this post as @bob.example.com.',
    })
  })
})

// A client whose reads lag its writes: every read shows the post as it was.
function stale(made: Fake[]) {
  made[0]!.client.fetchStatus!.mockImplementation(async () => post({ viewerOf: BOB }))
}

describe('rule 8: an acked write holds through read lag', () => {
  it('a like, then a stale reread: still liked with the acked record; the undo deletes it; no second like', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    stale(made)
    const liked = await actAs(BOB, 'favourite', post(), VIEW)
    expect(liked).toMatchObject({ kind: 'ok', view: { favourited: true, likeUri: BOB_LIKE } })
    const reread = await readAsAccount(BOB, post())
    expect(reread).toEqual({ kind: 'ok', view: { ...VIEW, favourited: true, likeUri: BOB_LIKE } })
    await actAs(BOB, 'favourite', post(), (reread as { view: ActAsView }).view)
    expect(made[0]!.client.favourite).toHaveBeenCalledTimes(1)
    expect(made[0]!.client.unfavourite).toHaveBeenCalledWith(expect.objectContaining({
      bluesky: expect.objectContaining({ likeUri: BOB_LIKE }),
    }))
    // The undo is kept too: a stale read that still shows the like does not bring it back.
    made[0]!.client.fetchStatus!.mockImplementation(async () => post({ likeUri: BOB_LIKE, viewerOf: BOB }, { favourited: true }))
    expect(await readAsAccount(BOB, post())).toMatchObject({ view: { favourited: false, likeUri: null } })
  })

  it('a repost, then a stale reread: still reposted with the acked record', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    stale(made)
    await actAs(BOB, 'reblog', post(), VIEW)
    expect(await readAsAccount(BOB, post())).toMatchObject({
      view: { reblogged: true, repostUri: 'at://did:plc:bob/app.bsky.feed.repost/3kr' },
    })
    expect(made[0]!.client.reblog).toHaveBeenCalledTimes(1)
  })

  it('after the lag window, the read wins', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    stale(made)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    await actAs(BOB, 'favourite', post(), VIEW)
    clock.mockReturnValue(now + 59_999)
    expect(await readAsAccount(BOB, post())).toMatchObject({ view: { favourited: true } })
    clock.mockReturnValue(now + 60_000)
    expect(await readAsAccount(BOB, post())).toMatchObject({ view: { favourited: false, likeUri: null } })
  })

  it('a read waits for a write to the post that is still out', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    stale(made)
    let release!: () => void
    made[0]!.client.favourite!.mockImplementationOnce(() => new Promise((r) => {
      release = () => r({ ack: true, id: POST, on: true, record: BOB_LIKE })
    }))
    const write = actAs(BOB, 'favourite', post(), VIEW)
    const read = readAsAccount(BOB, post())
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(made[0]!.client.fetchStatus).toHaveBeenCalledTimes(1)
    release()
    await write
    expect(await read).toMatchObject({ view: { favourited: true, likeUri: BOB_LIKE } })
  })

  it('a read that started before the write finished does not undo it, even after the window', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    let answer!: () => void
    made[0]!.client.fetchStatus!.mockImplementationOnce(() => new Promise((r) => { answer = () => r(post({ viewerOf: BOB })) }))
    const read = readAsAccount(BOB, post())
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await actAs(BOB, 'favourite', post(), VIEW)
    vi.spyOn(Date, 'now').mockReturnValue(now + 120_000)
    answer()
    expect(await read).toMatchObject({ view: { favourited: true, likeUri: BOB_LIKE } })
  })

  it('a failed write keeps nothing', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    stale(made)
    made[0]!.client.favourite!.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await actAs(BOB, 'favourite', post(), VIEW)
    expect(await readAsAccount(BOB, post())).toMatchObject({ view: { favourited: false } })
  })

  it('the kept answer belongs to its account: another account reads its own view', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'), bsky('did:plc:carol'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    stale(made)
    await actAs(BOB, 'favourite', post(), VIEW)
    await readAsAccount(CAROL, post())
    made[1]!.client.fetchStatus!.mockImplementation(async () => post({ viewerOf: CAROL }))
    expect(await readAsAccount(CAROL, post())).toMatchObject({ view: { favourited: false, likeUri: null } })
  })
})

describe('rule 5: expiry voids older answers', () => {
  it('an ack that lands after the session expired answers expired', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    let release!: () => void
    made[0]!.client.favourite!.mockImplementationOnce(() => new Promise((r) => {
      release = () => r({ ack: true, id: POST, on: true, record: BOB_LIKE })
    }))
    const write = actAs(BOB, 'favourite', post(), VIEW)
    made[0]!.client.bookmark!.mockImplementationOnce(async () => {
      made[0]!.expire()
      throw new CaribouError('unauthorized', 'gone')
    })
    expect(await actAs(BOB, 'bookmark', post(), VIEW)).toEqual({ kind: 'expired' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    expect(await write).toEqual({ kind: 'expired' })
  })

  it('a read that lands after the session expired answers expired', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    let answer!: () => void
    made[0]!.client.fetchStatus!.mockImplementationOnce(() => new Promise((r) => { answer = () => r(post({ viewerOf: BOB })) }))
    const read = readAsAccount(BOB, post())
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    markExpired(BOB, 'G-did:plc:bob')
    answer()
    expect(await read).toEqual({ kind: 'expired' })
  })

  it('an answer for an older sign-in is not kept and says to try again', async () => {
    const { made } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    let release!: () => void
    made[0]!.client.favourite!.mockImplementationOnce(() => new Promise((r) => {
      release = () => r({ ack: true, id: POST, on: true, record: BOB_LIKE })
    }))
    const write = actAs(BOB, 'favourite', post(), VIEW)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob', { generation: 'G2' }))
    release()
    expect(await write).toEqual({ kind: 'failed', message: '@bob.example.com signed in again. Try again.' })
  })
})

describe('rule 9: an old sign-in is forgotten', () => {
  it('a new sign-in gets a new client and none of the old kept answers', async () => {
    const { made, restore } = setup()
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob'))
    activeUserKey.value = ALICE
    await readAsAccount(BOB, post())
    stale(made)
    await actAs(BOB, 'favourite', post(), VIEW)
    signIn(bsky('did:plc:alice'), bsky('did:plc:bob', { generation: 'G2' }))
    await readAsAccount(BOB, post())
    expect(restore).toHaveBeenCalledTimes(2)
    made[1]!.client.fetchStatus!.mockImplementation(async () => post({ viewerOf: BOB }))
    expect(await readAsAccount(BOB, post())).toMatchObject({ view: { favourited: false } })
  })
})
