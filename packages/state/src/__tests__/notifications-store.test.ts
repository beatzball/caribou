import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient, FetchNotificationsParams } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'

const fetchNotifications = vi.fn<(p?: FetchNotificationsParams) => Promise<mastodon.v1.Notification[]>>()

vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createCaribouClient: (userKey: string) => ({ userKey, fetchNotifications }),
}))

const { statusCache, cacheStatus } = await import('../caches.js')
const { users, activeUserKey, addUserSession, removeSession } = await import('../users.js')
const {
  createNotificationsStore, compareNotificationIds, lastSeenNotificationId,
  markNotificationsSeen, startUnreadNotifications, unreadNotificationCount, UNREAD_CAP,
} = await import('../notifications-store.js')
import type { PollHost } from '../polling.js'

const key = toUserKey('alice', 'example.social')

function status(id: string, extra: Partial<mastodon.v1.Status> = {}): mastodon.v1.Status {
  return { id, content: `<p>${id}</p>`, account: { id: 'a1' }, ...extra } as unknown as mastodon.v1.Status
}

function notif(id: string, type = 'mention', withStatus = type !== 'follow'): mastodon.v1.Notification {
  return {
    id, type, createdAt: '2024-01-01T00:00:00.000Z', groupKey: `ungrouped-${id}`,
    account: { id: `acc${id}` },
    ...(withStatus ? { status: status(`s${id}`) } : {}),
  } as unknown as mastodon.v1.Notification
}

function signIn(token = 'T1') {
  addUserSession({
    userKey: key, server: 'example.social', token, vapidKey: '',
    account: null, createdAt: 1,
  })
}

function host(): PollHost & { visibilityState: DocumentVisibilityState } {
  let vis: DocumentVisibilityState = 'visible'
  const listeners = new Set<() => void>()
  return {
    get visibilityState() { return vis },
    set visibilityState(v) { vis = v; for (const fn of listeners) fn() },
    addVisibilityListener(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  fetchNotifications.mockReset()
  fetchNotifications.mockResolvedValue([])
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  unreadNotificationCount.value = 0
  localStorage.clear()
})

describe('compareNotificationIds', () => {
  it('orders by length first, then lexically, without losing precision', () => {
    expect(compareNotificationIds('9', '10')).toBeLessThan(0)
    expect(compareNotificationIds('113000000000000001', '113000000000000000')).toBeGreaterThan(0)
    expect(compareNotificationIds('5', '5')).toBe(0)
  })
})

describe('createNotificationsStore', () => {
  function client(): CaribouClient {
    return { fetchNotifications } as unknown as CaribouClient
  }

  it('load() asks for every type by default and caches the posts', async () => {
    fetchNotifications.mockResolvedValueOnce([notif('2'), notif('1', 'follow')])
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    expect(fetchNotifications).toHaveBeenCalledWith({ types: [] })
    expect(store.notifications.value.map((n) => n.id)).toEqual(['2', '1'])
    expect(statusCache.value.has('s2')).toBe(true)
    expect(store.hasMore.value).toBe(true)
  })

  it('the mentions filter sends types[]=mention', async () => {
    const store = createNotificationsStore({ clientSource: client, filter: 'mentions' })
    await store.load()
    expect(fetchNotifications).toHaveBeenCalledWith({ types: ['mention'] })
    expect(store.hasMore.value).toBe(false)
  })

  it('loadMore() pages with max_id and drops duplicates', async () => {
    fetchNotifications.mockResolvedValueOnce([notif('3'), notif('2')])
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    fetchNotifications.mockResolvedValueOnce([notif('2'), notif('1')])
    await store.loadMore()
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: [], maxId: '2' })
    expect(store.notifications.value.map((n) => n.id)).toEqual(['3', '2', '1'])
  })

  it('poll() prepends what is newer than the first one', async () => {
    fetchNotifications.mockResolvedValueOnce([notif('2')])
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    fetchNotifications.mockResolvedValueOnce([notif('4'), notif('3')])
    await store.poll()
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: [], sinceId: '2' })
    expect(store.notifications.value.map((n) => n.id)).toEqual(['4', '3', '2'])
  })

  it('a post changed in the cache shows in its notification', async () => {
    fetchNotifications.mockResolvedValueOnce([notif('1', 'favourite')])
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    cacheStatus(status('s1', { favourited: true }))
    expect(store.notifications.value[0]!.status?.favourited).toBe(true)
  })

  it('an error is kept on the store', async () => {
    fetchNotifications.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'server_error' }))
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    expect(store.error.value?.message).toBe('boom')
    expect(store.loading.value).toBe(false)
  })

  it('does nothing without a client', async () => {
    const store = createNotificationsStore({ clientSource: () => null })
    await store.load()
    expect(fetchNotifications).not.toHaveBeenCalled()
    expect(store.notifications.value).toEqual([])
  })
})

describe('seen marker', () => {
  it('is stored in caribou.prefs.<userKey> beside other prefs, and only moves forward', () => {
    signIn()
    localStorage.setItem(`caribou.prefs.${key}`, JSON.stringify({ theme: 'dark' }))
    markNotificationsSeen('10')
    markNotificationsSeen('9')
    expect(JSON.parse(localStorage.getItem(`caribou.prefs.${key}`)!)).toEqual({
      theme: 'dark', lastSeenNotificationId: '10',
    })
    expect(lastSeenNotificationId(key)).toBe('10')
  })

  it('reads a broken prefs entry as no marker', () => {
    localStorage.setItem(`caribou.prefs.${key}`, '{nope')
    expect(lastSeenNotificationId(key)).toBeNull()
  })
})

describe('startUnreadNotifications', () => {
  afterEach(() => { vi.useRealTimers() })

  it('counts what is newer than the marker, now and every minute while visible', async () => {
    vi.useFakeTimers()
    signIn()
    markNotificationsSeen('5')
    fetchNotifications.mockResolvedValue([notif('7'), notif('6')])
    const h = host()
    const stop = startUnreadNotifications({ host: h })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchNotifications).toHaveBeenCalledWith({ sinceId: '5', limit: UNREAD_CAP })
    expect(unreadNotificationCount.value).toBe(2)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchNotifications).toHaveBeenCalledTimes(2)
    h.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(180_000)
    expect(fetchNotifications).toHaveBeenCalledTimes(2)
    stop()
  })

  it('without a marker counts the first page', async () => {
    signIn()
    fetchNotifications.mockResolvedValue([notif('2'), notif('1')])
    const stop = startUnreadNotifications({ host: host() })
    await flush()
    expect(fetchNotifications).toHaveBeenCalledWith({ limit: UNREAD_CAP })
    expect(unreadNotificationCount.value).toBe(2)
    stop()
  })

  it('does not fetch when signed out, and clears the count on sign-out', async () => {
    const stop = startUnreadNotifications({ host: host() })
    await flush()
    expect(fetchNotifications).not.toHaveBeenCalled()

    fetchNotifications.mockResolvedValue([notif('1')])
    signIn()
    await flush()
    expect(unreadNotificationCount.value).toBe(1)

    removeSession(key, 'T1')
    expect(unreadNotificationCount.value).toBe(0)
    expect(lastSeenNotificationId(key)).toBeNull()
    stop()
  })

  it('drops a reply that arrives after the session changed', async () => {
    signIn('T1')
    let resolve!: (v: mastodon.v1.Notification[]) => void
    fetchNotifications.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const stop = startUnreadNotifications({ host: host() })
    signIn('T2')
    resolve([notif('3'), notif('2'), notif('1')])
    await flush()
    expect(unreadNotificationCount.value).toBe(0)
    stop()
  })

  it('marking seen clears the count', async () => {
    signIn()
    fetchNotifications.mockResolvedValue([notif('1')])
    const stop = startUnreadNotifications({ host: host() })
    await flush()
    expect(unreadNotificationCount.value).toBe(1)
    markNotificationsSeen('1')
    expect(unreadNotificationCount.value).toBe(0)
    stop()
  })
})
