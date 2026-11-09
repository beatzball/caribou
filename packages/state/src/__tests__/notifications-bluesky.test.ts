import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import type {
  Capabilities, CaribouClient, FetchNotificationsParams, Notification, NotificationPage, Status,
} from '@beatzball/caribou-mastodon-client'

// A Mastodon account's client asks this, not the network.
const mastoFetch = vi.fn(async (..._: unknown[]) => [] as Notification[])
vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createCaribouClient: (userKey: string) => ({ userKey, fetchNotifications: (...a: unknown[]) => mastoFetch(...a) }),
}))

import { statusCache } from '../caches.js'
import { blueskyUserKey, setBlueskyDriver, type BlueskyDriver } from '../bluesky-session.js'
import { groupBlueskyNotifications } from '../notification-groups.js'
import {
  createNotificationsStore, lastSeenNotificationAt, markBlueskyNotificationsSeen, resetBlueskySeen,
  startUnreadNotifications, unreadNotificationCount, UNREAD_CAP,
} from '../notifications-store.js'
import type { PollHost } from '../polling.js'
import { activeUserKey, users, type BlueskySession, type UserSession } from '../users.js'

// The Bluesky rules in the README ("Notifications"): grouping and order by
// indexedAt, paging by cursor, the poll's catch-up, the badge and updateSeen.

const CAPS = { network: 'bluesky', readLagMs: 60_000 } as unknown as Capabilities
const alice = blueskyUserKey('did:plc:alice')
const bob = blueskyUserKey('did:plc:bob')
const masto = toUserKey('carol', 'example.social')
const POST = 'at://did:plc:alice/app.bsky.feed.post/p1'

const flush = () => new Promise((r) => setTimeout(r, 0))

// The authors' DIDs sort the other way from the times, so an id sort would
// show the wrong order.
function n(i: number, type: string, at: string, by = `did:plc:${'zyxwvutsrq'[i % 10]}`, post: string | null = POST): Notification {
  return {
    id: `at://${by}/app.bsky.feed.${type}/n${i}`, type, createdAt: at, groupKey: `at://${by}/n${i}`,
    account: { id: by, acct: `${by.slice(8)}.example.com` },
    ...(post && type !== 'follow' ? { status: { id: post, content: '', account: { id: 'did:plc:alice' } } as unknown as Status } : {}),
    bluesky: { uri: `at://${by}/n${i}`, reason: type, reasonSubject: post, indexedAt: at, isRead: false },
  } as unknown as Notification
}

function page(list: Notification[], nextCursor: string | null, hint?: NotificationPage['bluesky']): NotificationPage {
  return Object.assign([...list], { nextCursor, ...(hint ? { bluesky: hint } : {}) })
}

beforeEach(() => {
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  unreadNotificationCount.value = 0
  localStorage.clear()
  resetBlueskySeen()
})

describe('groupBlueskyNotifications', () => {
  it('groups likes on one post on one UTC day, newest first, each account once', () => {
    const rows = groupBlueskyNotifications([
      n(1, 'favourite', '2026-11-07T12:00:00.000Z', 'did:plc:bob'),
      n(2, 'favourite', '2026-11-07T09:00:00.000Z', 'did:plc:carol'),
      n(3, 'favourite', '2026-11-07T08:00:00.000Z', 'did:plc:bob'),
      // The day before: its own row.
      n(4, 'favourite', '2026-11-06T23:59:00.000Z', 'did:plc:dave'),
    ])
    expect(rows.map((g) => [g.key, g.count, g.accounts.map((a) => a.id)])).toEqual([
      [`favourite:${POST}:2026-11-07`, 3, ['did:plc:bob', 'did:plc:carol']],
      [`favourite:${POST}:2026-11-06`, 1, ['did:plc:dave']],
    ])
    expect(rows[0]).toMatchObject({
      complete: true, newestAt: '2026-11-07T12:00:00.000Z',
      newestId: 'at://did:plc:bob/app.bsky.feed.favourite/n1', oldestId: 'at://did:plc:bob/app.bsky.feed.favourite/n3',
    })
  })

  it('groups follows and reposts; a like and a repost of one post are two rows; a mention is one row', () => {
    const rows = groupBlueskyNotifications([
      n(1, 'follow', '2026-11-07T12:00:00.000Z'),
      n(2, 'reblog', '2026-11-07T11:00:00.000Z'),
      n(3, 'favourite', '2026-11-07T10:00:00.000Z'),
      n(4, 'follow', '2026-11-07T09:00:00.000Z'),
      n(5, 'mention', '2026-11-07T08:00:00.000Z'),
      n(6, 'mention', '2026-11-07T07:00:00.000Z'),
    ])
    expect(rows.map((g) => `${g.type}:${g.count}`)).toEqual(['follow:2', 'reblog:1', 'favourite:1', 'mention:1', 'mention:1'])
  })

  it('orders rows by indexedAt, not by id or by the order given; equal times keep the order given', () => {
    const rows = groupBlueskyNotifications([
      n(1, 'mention', '2026-11-07T08:00:00.000Z', 'did:plc:aaa'),
      n(2, 'mention', '2026-11-07T12:00:00.000Z', 'did:plc:zzz'),
      n(3, 'mention', '2026-11-07T10:00:00.000Z', 'did:plc:mmm'),
      n(4, 'mention', '2026-11-07T10:00:00.000Z', 'did:plc:bbb'),
    ])
    expect(rows.map((g) => g.accounts[0]!.id)).toEqual(['did:plc:zzz', 'did:plc:mmm', 'did:plc:bbb', 'did:plc:aaa'])
  })

  it('a new like that joins a group moves the row to the top and keeps its key', () => {
    const before = groupBlueskyNotifications([
      n(1, 'mention', '2026-11-07T11:00:00.000Z'),
      n(2, 'favourite', '2026-11-07T09:00:00.000Z', 'did:plc:bob'),
    ])
    const after = groupBlueskyNotifications([
      n(3, 'favourite', '2026-11-07T12:00:00.000Z', 'did:plc:carol'),
      n(1, 'mention', '2026-11-07T11:00:00.000Z'),
      n(2, 'favourite', '2026-11-07T09:00:00.000Z', 'did:plc:bob'),
    ])
    expect(after.map((g) => g.key)).toEqual([before[1]!.key, before[0]!.key])
    expect(after[0]!.accounts.map((a) => a.id)).toEqual(['did:plc:carol', 'did:plc:bob'])
  })

  it('an unknown type is a row of one and never throws', () => {
    expect(groupBlueskyNotifications([n(1, 'something-new', '2026-11-07T12:00:00.000Z')]).map((g) => g.count)).toEqual([1])
  })
})

function bskyClient(fetchNotifications: (p?: FetchNotificationsParams) => Promise<NotificationPage>, userKey = alice) {
  const fetchGroupedNotifications = vi.fn(async () => { throw new Error('never asked for Bluesky') })
  return {
    client: { userKey, capabilities: CAPS, fetchNotifications, fetchGroupedNotifications } as unknown as CaribouClient,
    fetchGroupedNotifications,
  }
}

describe('the store: paging ends only on a null cursor (both networks)', () => {
  it('Mastodon single notifications: an empty page with a cursor keeps Load older', async () => {
    const fetchNotifications = vi.fn(async (p?: FetchNotificationsParams) =>
      p?.cursor === 'more' ? page([], null) : page([], 'more'))
    const store = createNotificationsStore({ clientSource: () => ({ userKey: masto, fetchNotifications }) as unknown as CaribouClient })
    await store.load()
    expect(store.groups.value).toEqual([])
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: [], cursor: 'more' })
    expect(store.hasMore.value).toBe(false)
  })

  it('Mastodon grouped: an empty page with a cursor keeps Load older', async () => {
    const fetchGroupedNotifications = vi.fn(async (p?: FetchNotificationsParams) => ({
      accounts: [], statuses: [], notificationGroups: [], nextCursor: p?.cursor ? null : '40',
    }))
    const store = createNotificationsStore({
      clientSource: () => ({ userKey: masto, fetchGroupedNotifications, fetchNotifications: vi.fn() }) as unknown as CaribouClient,
    })
    await store.load()
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    expect(fetchGroupedNotifications).toHaveBeenLastCalledWith({ types: [], cursor: '40' })
    expect(store.hasMore.value).toBe(false)
  })

  it('Bluesky: a page of only skipped notifications keeps Load older, and the next page comes in', async () => {
    const fetchNotifications = vi.fn(async (p?: FetchNotificationsParams) => p?.cursor === 'c1'
      ? page([n(1, 'mention', '2026-11-06T10:00:00.000Z')], null)
      : page([], 'c1'))
    const { client, fetchGroupedNotifications } = bskyClient(fetchNotifications)
    const store = createNotificationsStore({ clientSource: () => client })
    await store.load()
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: [], cursor: 'c1' })
    expect(store.groups.value).toHaveLength(1)
    expect(store.hasMore.value).toBe(false)
    expect(fetchGroupedNotifications).not.toHaveBeenCalled()
  })
})

describe('the store: Bluesky', () => {
  it('load groups and orders by indexedAt and caches the posts with their provenance', async () => {
    const { client } = bskyClient(async () => page([
      n(1, 'favourite', '2026-11-07T09:00:00.000Z', 'did:plc:bob'),
      n(2, 'mention', '2026-11-07T12:00:00.000Z', 'did:plc:carol', 'at://did:plc:carol/app.bsky.feed.post/r1'),
      n(3, 'favourite', '2026-11-07T08:00:00.000Z', 'did:plc:dave'),
    ], 'next', { newestAt: '2026-11-07T12:00:00.000Z', unread: true }))
    const store = createNotificationsStore({ clientSource: () => client })
    await store.load()
    expect(store.groups.value.map((g) => `${g.type}:${g.count}`)).toEqual(['mention:1', 'favourite:2'])
    expect(statusCache.value.has(POST)).toBe(true)
    expect(store.seen.value).toEqual({ newestAt: '2026-11-07T12:00:00.000Z', unread: true })
  })

  it('a poll asks from the newest one shown and merges what is above it', async () => {
    const fetchNotifications = vi.fn(async (p?: FetchNotificationsParams) => p?.sinceId
      ? page([n(3, 'favourite', '2026-11-07T13:00:00.000Z', 'did:plc:eve')], null, { newestAt: '2026-11-07T13:00:00.000Z', unread: true })
      : page([
          n(1, 'mention', '2026-11-07T08:00:00.000Z', 'did:plc:aaa'),
          n(2, 'favourite', '2026-11-07T12:00:00.000Z', 'did:plc:zzz'),
        ], 'next', { newestAt: '2026-11-07T12:00:00.000Z', unread: false }))
    const { client } = bskyClient(fetchNotifications)
    const store = createNotificationsStore({ clientSource: () => client })
    await store.load()
    const likeKey = store.groups.value[0]!.key
    await store.poll()
    // By indexedAt, not by the AppView's or the id's order.
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: [], sinceId: n(2, 'favourite', '', 'did:plc:zzz').id })
    expect(store.groups.value.map((g) => [g.key, g.count])).toEqual([[likeKey, 2], [expect.stringMatching(/^ungrouped-/), 1]])
    expect(store.seen.value).toEqual({ newestAt: '2026-11-07T13:00:00.000Z', unread: true })
    // The poll does not touch Load older.
    expect(store.hasMore.value).toBe(true)
  })

  it('a poll that meets a gap starts the list again from what it read, with its cursor', async () => {
    const fetchNotifications = vi.fn(async (p?: FetchNotificationsParams) => p?.sinceId
      ? page([n(9, 'mention', '2026-11-08T10:00:00.000Z')], 'after-gap')
      : page([n(1, 'mention', '2026-11-07T08:00:00.000Z')], null))
    const { client } = bskyClient(fetchNotifications)
    const store = createNotificationsStore({ clientSource: () => client })
    await store.load()
    expect(store.hasMore.value).toBe(false)
    await store.poll()
    expect(store.groups.value.map((g) => g.newestId)).toEqual([n(9, 'mention', '').id])
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: [], cursor: 'after-gap' })
  })

  it('Load older does not move the seen hint', async () => {
    const fetchNotifications = vi.fn(async (p?: FetchNotificationsParams) => p?.cursor
      ? page([n(2, 'mention', '2026-11-01T08:00:00.000Z')], null, { newestAt: '2026-11-01T08:00:00.000Z', unread: true })
      : page([n(1, 'mention', '2026-11-07T08:00:00.000Z')], 'c', { newestAt: '2026-11-07T08:00:00.000Z', unread: false }))
    const { client } = bskyClient(fetchNotifications)
    const store = createNotificationsStore({ clientSource: () => client })
    await store.load()
    await store.loadMore()
    expect(store.seen.value).toEqual({ newestAt: '2026-11-07T08:00:00.000Z', unread: false })
  })

  it('a Mastodon list has no seen hint', async () => {
    const store = createNotificationsStore({
      clientSource: () => ({ userKey: masto, fetchNotifications: async () => page([], null) }) as unknown as CaribouClient,
    })
    await store.load()
    expect(store.seen.value).toBeNull()
  })
})

// --- the badge and updateSeen ----------------------------------------------

function bskySession(userKey = alice, generation = 'G1'): BlueskySession {
  return {
    network: 'bluesky', userKey, did: userKey.slice(0, -5), handle: 'x.example.com',
    pds: 'https://pds.example.test', generation, account: null, createdAt: 1,
  }
}

function mastoSession(): UserSession {
  return { userKey: masto, server: 'example.social', token: 'T', vapidKey: '', generation: 'M1', account: null, createdAt: 1 }
}

function signIn(...sessions: UserSession[]) {
  users.value = new Map([...users.value, ...sessions.map((s) => [s.userKey, s] as const)])
  activeUserKey.value = sessions[0]!.userKey
}

interface Fake {
  getUnreadCount: ReturnType<typeof vi.fn<() => Promise<number>>>
  updateSeen: ReturnType<typeof vi.fn<(at: string) => Promise<void>>>
  fetchNotifications: ReturnType<typeof vi.fn>
}

const fakes = new Map<string, Fake>()
function fakeFor(userKey: string): Fake {
  let f = fakes.get(userKey)
  if (!f) {
    f = {
      getUnreadCount: vi.fn(async () => 0),
      updateSeen: vi.fn(async () => {}),
      fetchNotifications: vi.fn(async () => page([], null)),
    }
    fakes.set(userKey, f)
  }
  return f
}

function host(): PollHost {
  return { visibilityState: 'visible', addVisibilityListener: () => () => {} }
}

describe('unread badge and updateSeen (Bluesky)', () => {
  let stop: (() => void) | null = null

  beforeEach(() => {
    fakes.clear()
    const driver: BlueskyDriver = {
      capabilities: CAPS,
      timelineOrder: () => null,
      restore: async (s) => ({ userKey: s.userKey, capabilities: CAPS, ...fakeFor(s.userKey) }) as unknown as CaribouClient,
      signOut: async () => {},
    }
    setBlueskyDriver(driver)
  })

  afterEach(() => {
    stop?.()
    stop = null
    setBlueskyDriver(null)
  })

  it('shows the server count, capped for "40+"', async () => {
    signIn(bskySession())
    fakeFor(alice).getUnreadCount.mockResolvedValue(7)
    stop = startUnreadNotifications({ host: host() })
    await vi.waitFor(() => expect(unreadNotificationCount.value).toBe(7))
    fakeFor(alice).getUnreadCount.mockResolvedValue(500)
    stop()
    stop = startUnreadNotifications({ host: host() })
    await vi.waitFor(() => expect(unreadNotificationCount.value).toBe(UNREAD_CAP))
  })

  it('an account switch drops the old badge at once, and a late answer for it is dropped', async () => {
    signIn(bskySession(), bskySession(bob, 'G2'))
    let answer!: (n: number) => void
    fakeFor(alice).getUnreadCount.mockImplementation(() => new Promise((r) => { answer = r }))
    fakeFor(bob).getUnreadCount.mockResolvedValue(0)
    stop = startUnreadNotifications({ host: host() })
    await vi.waitFor(() => expect(fakeFor(alice).getUnreadCount).toHaveBeenCalled())
    unreadNotificationCount.value = 5
    activeUserKey.value = bob
    expect(unreadNotificationCount.value).toBe(0)
    answer(9)
    await flush()
    await flush()
    expect(unreadNotificationCount.value).toBe(0)
  })

  it('to a Mastodon account: the Bluesky badge goes at once, and Mastodon counts as before', async () => {
    signIn(bskySession(), mastoSession())
    fakeFor(alice).getUnreadCount.mockResolvedValue(4)
    stop = startUnreadNotifications({ host: host() })
    await vi.waitFor(() => expect(unreadNotificationCount.value).toBe(4))
    mastoFetch.mockResolvedValue([{ id: '1' }, { id: '2' }] as unknown as Notification[])
    activeUserKey.value = masto
    expect(unreadNotificationCount.value).toBe(0)
    await vi.waitFor(() => expect(unreadNotificationCount.value).toBe(2))
    expect(fakeFor(alice).getUnreadCount).toHaveBeenCalledTimes(1)
  })

  it('sends updateSeen once for what the list read, and the badge goes to 0', async () => {
    signIn(bskySession())
    unreadNotificationCount.value = 3
    const hint = { newestAt: '2026-11-07T12:00:00.000Z', unread: true }
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint })
    expect(fakeFor(alice).updateSeen).toHaveBeenCalledTimes(1)
    expect(fakeFor(alice).updateSeen).toHaveBeenCalledWith('2026-11-07T12:00:00.000Z')
    expect(unreadNotificationCount.value).toBe(0)
    expect(lastSeenNotificationAt(alice)).toBe('2026-11-07T12:00:00.000Z')
    // The same view again, a poll with nothing new, or a reload: not again.
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint })
    resetBlueskySeen()
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint })
    expect(fakeFor(alice).updateSeen).toHaveBeenCalledTimes(1)
    // Something newer: once more.
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint: { newestAt: '2026-11-07T13:00:00.000Z', unread: true } })
    expect(fakeFor(alice).updateSeen).toHaveBeenCalledTimes(2)
  })

  it('sends nothing when nothing read was unread, or the hint is older than the last one sent', async () => {
    signIn(bskySession())
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint: { newestAt: '2026-11-07T12:00:00.000Z', unread: false } })
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint: null })
    localStorage.setItem(`caribou.prefs.${alice}`, JSON.stringify({ lastSeenNotificationAt: '2026-11-08T00:00:00.000Z' }))
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint: { newestAt: '2026-11-07T12:00:00.000Z', unread: true } })
    expect(fakeFor(alice).updateSeen).not.toHaveBeenCalled()
  })

  it('never for another account or another sign-in', async () => {
    signIn(bskySession(bob, 'G2'), bskySession())
    const hint = { newestAt: '2026-11-07T12:00:00.000Z', unread: true }
    // Alice's list, but Bob is active.
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint })
    // Bob's list from an older sign-in.
    await markBlueskyNotificationsSeen({ userKey: bob, generation: 'OLD', hint })
    expect(fakeFor(alice).updateSeen).not.toHaveBeenCalled()
    expect(fakeFor(bob).updateSeen).not.toHaveBeenCalled()
    // A Mastodon account active: nothing either.
    signIn(mastoSession())
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint })
    expect(fakeFor(alice).updateSeen).not.toHaveBeenCalled()
  })

  it('an answer after a switch keeps the new account\'s badge', async () => {
    signIn(bskySession(), bskySession(bob, 'G2'))
    let done!: () => void
    fakeFor(alice).updateSeen.mockImplementation(() => new Promise<void>((r) => { done = r }))
    const sent = markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint: { newestAt: '2026-11-07T12:00:00.000Z', unread: true } })
    await vi.waitFor(() => expect(fakeFor(alice).updateSeen).toHaveBeenCalled())
    activeUserKey.value = bob
    unreadNotificationCount.value = 2
    done()
    await sent
    expect(unreadNotificationCount.value).toBe(2)
    // The sent marker still moves: the server did take it.
    expect(lastSeenNotificationAt(alice)).toBe('2026-11-07T12:00:00.000Z')
  })

  it('one request at a time; a newer one asked for meanwhile is sent after it', async () => {
    signIn(bskySession())
    let done!: () => void
    fakeFor(alice).updateSeen.mockImplementationOnce(() => new Promise<void>((r) => { done = r }))
    const first = markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint: { newestAt: '2026-11-07T12:00:00.000Z', unread: true } })
    await vi.waitFor(() => expect(fakeFor(alice).updateSeen).toHaveBeenCalledTimes(1))
    void markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint: { newestAt: '2026-11-07T12:00:00.000Z', unread: true } })
    void markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint: { newestAt: '2026-11-07T13:00:00.000Z', unread: true } })
    expect(fakeFor(alice).updateSeen).toHaveBeenCalledTimes(1)
    done()
    await first
    await vi.waitFor(() => expect(fakeFor(alice).updateSeen).toHaveBeenCalledTimes(2))
    expect(fakeFor(alice).updateSeen).toHaveBeenLastCalledWith('2026-11-07T13:00:00.000Z')
  })

  it('a failed updateSeen changes nothing, and the next view tries again', async () => {
    signIn(bskySession())
    unreadNotificationCount.value = 3
    fakeFor(alice).updateSeen.mockRejectedValueOnce(new Error('offline'))
    const hint = { newestAt: '2026-11-07T12:00:00.000Z', unread: true }
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint })
    expect(unreadNotificationCount.value).toBe(3)
    expect(lastSeenNotificationAt(alice)).toBeNull()
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint })
    expect(fakeFor(alice).updateSeen).toHaveBeenCalledTimes(2)
    expect(unreadNotificationCount.value).toBe(0)
  })

  it('drops a count whose request started before updateSeen landed', async () => {
    signIn(bskySession())
    let answer!: (n: number) => void
    fakeFor(alice).getUnreadCount.mockImplementationOnce(() => new Promise((r) => { answer = r }))
    stop = startUnreadNotifications({ host: host() })
    await vi.waitFor(() => expect(fakeFor(alice).getUnreadCount).toHaveBeenCalled())
    await markBlueskyNotificationsSeen({ userKey: alice, generation: 'G1', hint: { newestAt: '2026-11-07T12:00:00.000Z', unread: true } })
    answer(6)
    await flush()
    await flush()
    expect(unreadNotificationCount.value).toBe(0)
  })
})
