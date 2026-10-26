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
  NOTIFICATIONS_PAGE, NOTIFICATIONS_POLL_MAX_PAGES,
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

  // Ids from `to` down to `from`, newest first, as the server sends them.
  const range = (to: number, from: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => notif(String(to - i), 'follow'))
  const ids = (store: { notifications: { value: mastodon.v1.Notification[] } }) =>
    store.notifications.value.map((n) => n.id)

  it('poll() prepends what is newer than the first one, paging forward with min_id', async () => {
    fetchNotifications.mockResolvedValueOnce([notif('2')])
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    fetchNotifications.mockResolvedValueOnce([notif('4'), notif('3')])
    await store.poll()
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: [], minId: '2', limit: NOTIFICATIONS_PAGE })
    expect(ids(store)).toEqual(['4', '3', '2'])
  })

  it('poll() fetches every page that came in before it merges, so no notification is lost', async () => {
    fetchNotifications.mockResolvedValueOnce(range(10, 1))
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    // 50 came in: a full page just above 10, then the rest.
    fetchNotifications.mockResolvedValueOnce(range(50, 11))
    fetchNotifications.mockResolvedValueOnce(range(60, 51))
    await store.poll()
    expect(fetchNotifications.mock.calls.slice(1).map((c) => c[0]?.minId)).toEqual(['10', '50'])
    expect(ids(store)).toEqual(range(60, 1).map((n) => n.id))
  })

  it('poll() stops at the page cap, keeps what joins the list, and the next poll goes on', async () => {
    fetchNotifications.mockResolvedValueOnce(range(1, 1))
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    const cap = NOTIFICATIONS_POLL_MAX_PAGES
    for (let i = 0; i < cap; i++) {
      const low = 2 + i * NOTIFICATIONS_PAGE
      fetchNotifications.mockResolvedValueOnce(range(low + NOTIFICATIONS_PAGE - 1, low))
    }
    await store.poll()
    expect(fetchNotifications).toHaveBeenCalledTimes(1 + cap)
    const top = 1 + cap * NOTIFICATIONS_PAGE
    expect(ids(store)).toEqual(range(top, 1).map((n) => n.id))

    fetchNotifications.mockResolvedValueOnce([])
    await store.poll()
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: [], minId: String(top), limit: NOTIFICATIONS_PAGE })
  })

  it('a poll that fails on a later page merges nothing, keeps the rows, and the next success clears the error', async () => {
    fetchNotifications.mockResolvedValueOnce(range(10, 1))
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    fetchNotifications.mockResolvedValueOnce(range(50, 11))
    fetchNotifications.mockRejectedValueOnce(new Error('blip'))
    await store.poll()
    expect(ids(store)).toEqual(range(10, 1).map((n) => n.id))
    expect(store.error.value?.message).toBe('blip')

    fetchNotifications.mockResolvedValueOnce([notif('11')])
    await store.poll()
    expect(ids(store)[0]).toBe('11')
    expect(store.error.value).toBeNull()
  })

  it('poll() on an empty list asks for the first page', async () => {
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    expect(store.hasMore.value).toBe(false)
    fetchNotifications.mockResolvedValueOnce([notif('1')])
    await store.poll()
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: [] })
    expect(ids(store)).toEqual(['1'])
    expect(store.hasMore.value).toBe(true)
  })

  it('a failed Load older keeps the rows, and the next success clears the error', async () => {
    fetchNotifications.mockResolvedValueOnce([notif('3')])
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    fetchNotifications.mockRejectedValueOnce(new Error('blip'))
    await store.loadMore()
    expect(ids(store)).toEqual(['3'])
    expect(store.error.value?.message).toBe('blip')
    fetchNotifications.mockResolvedValueOnce([notif('2')])
    await store.loadMore()
    expect(ids(store)).toEqual(['3', '2'])
    expect(store.error.value).toBeNull()
  })

  it('drops a poll reply that arrives after load() replaced the list', async () => {
    fetchNotifications.mockResolvedValueOnce([notif('1')])
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    let resolve!: (v: mastodon.v1.Notification[]) => void
    fetchNotifications.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const polled = store.poll()
    fetchNotifications.mockResolvedValueOnce([notif('5')])
    await store.load()
    resolve([notif('2')])
    await polled
    expect(ids(store)).toEqual(['5'])
  })

  it('runs one poll at a time', async () => {
    fetchNotifications.mockResolvedValueOnce([notif('1')])
    const store = createNotificationsStore({ clientSource: client })
    await store.load()
    await Promise.all([store.poll(), store.poll(), store.poll()])
    expect(fetchNotifications).toHaveBeenCalledTimes(2)
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

  it('with a user key, moves only that user\'s marker, and only while they are active', () => {
    signIn()
    unreadNotificationCount.value = 3
    markNotificationsSeen('10', toUserKey('bob', 'example.social'))
    expect(lastSeenNotificationId(key)).toBeNull()
    expect(unreadNotificationCount.value).toBe(3)
    markNotificationsSeen('10', key)
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

  it('drops a reply that arrives after it was stopped', async () => {
    signIn()
    let resolve!: (v: mastodon.v1.Notification[]) => void
    fetchNotifications.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const stop = startUnreadNotifications({ host: host() })
    stop()
    resolve([notif('1')])
    await flush()
    expect(unreadNotificationCount.value).toBe(0)
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
