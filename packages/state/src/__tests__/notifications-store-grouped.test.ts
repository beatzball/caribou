import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import {
  CaribouError, type CaribouClient, type FetchGroupedNotificationsParams, type FetchNotificationsParams,
  type GroupedNotificationsPage, type NotificationGroupData,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus, statusCache } from '../caches.js'
import { createNotificationsStore, NOTIFICATIONS_PAGE, resetGroupedSupport } from '../notifications-store.js'

const fetchNotifications = vi.fn<(p?: FetchNotificationsParams) => Promise<mastodon.v1.Notification[]>>()
const fetchGroupedNotifications = vi.fn<(p?: FetchGroupedNotificationsParams) => Promise<GroupedNotificationsPage>>()

function client(userKey = 'alice@example.social'): CaribouClient {
  return { userKey, fetchNotifications, fetchGroupedNotifications } as unknown as CaribouClient
}

function account(id: string): mastodon.v1.Account {
  return { id, acct: id, username: id, displayName: id } as unknown as mastodon.v1.Account
}

function g(key: string, type: string, min: string, max: string, by: string[], count = by.length): NotificationGroupData {
  return {
    groupKey: key, type, notificationsCount: count, mostRecentNotificationId: max,
    pageMinId: min, pageMaxId: max, sampleAccountIds: by,
    ...(type === 'follow' ? {} : { statusId: 's1' }),
  }
}

function page(groups: NotificationGroupData[]): GroupedNotificationsPage {
  return {
    accounts: ['alice', 'bob', 'carol', 'dave'].map(account),
    statuses: [{ id: 's1', content: '<p>s1</p>', account: { id: 'me' } } as unknown as mastodon.v1.Status],
    notificationGroups: groups,
  }
}

const rows = (store: ReturnType<typeof createNotificationsStore>) =>
  store.groups.value.map((x) => `${x.type}:${x.count}:${x.accounts.map((a) => a.id).join(',')}`)

beforeEach(() => {
  fetchNotifications.mockReset()
  fetchNotifications.mockResolvedValue([])
  fetchGroupedNotifications.mockReset()
  fetchGroupedNotifications.mockResolvedValue(page([]))
  statusCache.value = new Map()
  resetGroupedSupport()
})

describe('createNotificationsStore with grouped notifications', () => {
  it('load() asks the grouped endpoint and shows its groups', async () => {
    fetchGroupedNotifications.mockResolvedValueOnce(page([
      g('favourite-s1', 'favourite', '5', '9', ['alice', 'bob'], 14),
      g('ungrouped-4', 'mention', '4', '4', ['carol']),
    ]))
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    expect(fetchGroupedNotifications).toHaveBeenCalledWith({ types: [] })
    expect(fetchNotifications).not.toHaveBeenCalled()
    expect(rows(store)).toEqual(['favourite:14:alice,bob', 'mention:1:carol'])
    expect(store.groups.value[0]!.status?.id).toBe('s1')
    expect(statusCache.value.has('s1')).toBe(true)
    expect(store.hasMore.value).toBe(true)
  })

  it('loadMore() pages below the oldest id and merges a group that goes on', async () => {
    fetchGroupedNotifications.mockResolvedValueOnce(page([
      g('ungrouped-12', 'mention', '12', '12', ['carol']),
      g('favourite-s1', 'favourite', '5', '9', ['alice']),
    ]))
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    fetchGroupedNotifications.mockResolvedValueOnce(page([
      g('favourite-s1', 'favourite', '2', '4', ['bob', 'alice'], 2),
      g('follow-1', 'follow', '1', '1', ['dave']),
    ]))
    await store.loadMore()
    expect(fetchGroupedNotifications).toHaveBeenLastCalledWith({ types: [], maxId: '5' })
    expect(rows(store)).toEqual(['mention:1:carol', 'favourite:3:alice,bob', 'follow:1:dave'])
    fetchGroupedNotifications.mockResolvedValueOnce(page([]))
    await store.loadMore()
    expect(store.hasMore.value).toBe(false)
  })

  it('poll() pages forward from the newest id and moves a joined group to the top', async () => {
    fetchGroupedNotifications.mockResolvedValueOnce(page([
      g('ungrouped-12', 'mention', '12', '12', ['carol']),
      g('favourite-s1', 'favourite', '5', '9', ['alice']),
    ]))
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    fetchGroupedNotifications.mockResolvedValueOnce(page([g('favourite-s1', 'favourite', '13', '13', ['dave'])]))
    await store.poll()
    expect(fetchGroupedNotifications).toHaveBeenLastCalledWith({ types: [], minId: '12', limit: NOTIFICATIONS_PAGE })
    expect(rows(store)).toEqual(['favourite:2:dave,alice', 'mention:1:carol'])
    expect(store.groups.value[0]!.newestId).toBe('13')
  })

  it('falls back to single notifications, grouped here, on a server without the endpoint, and remembers it', async () => {
    fetchGroupedNotifications.mockRejectedValue(new CaribouError('not_found', 'Not found'))
    fetchNotifications.mockResolvedValue([
      { id: '3', type: 'favourite', createdAt: '2026-11-01T00:00:00Z', account: account('alice'), status: { id: 's1' } },
      { id: '2', type: 'favourite', createdAt: '2026-11-01T00:00:00Z', account: account('bob'), status: { id: 's1' } },
    ] as unknown as mastodon.v1.Notification[])
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    expect(store.error.value).toBeNull()
    expect(rows(store)).toEqual(['favourite:2:alice,bob'])
    const again = createNotificationsStore({ clientSource: () => client() })
    await again.load()
    expect(fetchGroupedNotifications).toHaveBeenCalledTimes(1)
    expect(fetchNotifications).toHaveBeenCalledTimes(2)
  })

  it('remembers the fallback per account, not for every account', async () => {
    fetchGroupedNotifications.mockRejectedValueOnce(new CaribouError('not_found', 'Not found'))
    await createNotificationsStore({ clientSource: () => client('alice@old.example') }).load()
    await createNotificationsStore({ clientSource: () => client('bob@new.example') }).load()
    expect(fetchGroupedNotifications).toHaveBeenCalledTimes(2)
  })

  it('another error is shown, not taken for an older server', async () => {
    fetchGroupedNotifications.mockRejectedValueOnce(new CaribouError('server_error', 'boom'))
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    expect(store.error.value?.message).toBe('boom')
    expect(fetchNotifications).not.toHaveBeenCalled()
  })

  it('drops a page that arrives after load() started again', async () => {
    let resolve!: (p: GroupedNotificationsPage) => void
    fetchGroupedNotifications.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const store = createNotificationsStore({ clientSource: () => client() })
    const first = store.load()
    fetchGroupedNotifications.mockResolvedValueOnce(page([g('ungrouped-7', 'mention', '7', '7', ['carol'])]))
    await store.load()
    resolve(page([g('ungrouped-1', 'mention', '1', '1', ['alice'])]))
    await first
    expect(rows(store)).toEqual(['mention:1:carol'])
  })

  it('a post changed in the cache shows in its group', async () => {
    fetchGroupedNotifications.mockResolvedValueOnce(page([g('favourite-s1', 'favourite', '5', '9', ['alice'])]))
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    cacheStatus({ id: 's1', content: '<p>s1</p>', account: { id: 'me' }, favourited: true } as unknown as mastodon.v1.Status)
    expect(store.groups.value[0]!.status?.favourited).toBe(true)
  })
})
