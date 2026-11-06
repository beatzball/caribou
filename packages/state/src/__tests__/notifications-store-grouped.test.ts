import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CaribouError, type CaribouClient, type FetchGroupedNotificationsParams, type FetchNotificationsParams,
  type GroupedNotificationsPage, type NotificationGroupData,
  type Account,
  type Notification,
  type Status,
} from '@beatzball/caribou-mastodon-client'
import { accountCache, cacheStatus, statusCache } from '../caches.js'
import { activeUserKey } from '../users.js'
import { createNotificationsStore, NOTIFICATIONS_PAGE, resetGroupedSupport } from '../notifications-store.js'

const fetchNotifications = vi.fn<(p?: FetchNotificationsParams) => Promise<Notification[]>>()
const fetchGroupedNotifications = vi.fn<(p?: FetchGroupedNotificationsParams) => Promise<GroupedNotificationsPage>>()

function client(userKey = 'alice@example.social'): CaribouClient {
  return { userKey, fetchNotifications, fetchGroupedNotifications } as unknown as CaribouClient
}

function account(id: string): Account {
  return { id, acct: id, username: id, displayName: id } as unknown as Account
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
    statuses: [{ id: 's1', content: '<p>s1</p>', account: { id: 'me' } } as unknown as Status],
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
  accountCache.value = new Map()
  activeUserKey.value = null
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
      g('favourite-s1', 'favourite', '5', '9', ['alice'], 3),
    ]))
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    // The server's count runs up to the top of the page: the older page's 3
    // is the same three.
    fetchGroupedNotifications.mockResolvedValueOnce(page([
      g('favourite-s1', 'favourite', '2', '4', ['bob', 'alice'], 3),
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
    fetchGroupedNotifications.mockResolvedValueOnce(page([g('favourite-s1', 'favourite', '13', '13', ['dave', 'alice'], 2)]))
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
    ] as unknown as Notification[])
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

  it.each([400, 405, 410, 501])('falls back too when the server answers %i for the unknown path', async (status) => {
    fetchGroupedNotifications.mockRejectedValueOnce(new CaribouError('unknown', 'nope', { status }))
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    expect(store.error.value).toBeNull()
    expect(fetchNotifications).toHaveBeenCalledOnce()
  })

  it('a 400 falls back for this load only; the next load asks the grouped endpoint again', async () => {
    fetchGroupedNotifications.mockRejectedValueOnce(new CaribouError('unknown', 'bad request', { status: 400 }))
    await createNotificationsStore({ clientSource: () => client() }).load()
    const again = createNotificationsStore({ clientSource: () => client() })
    await again.load()
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

  const post = (content: string, favourited: boolean) =>
    ({ id: 's1', content, favourited, account: { id: 'me' } }) as unknown as Status
  const pageWith = (id: string, content: string, favourited: boolean, by: string): GroupedNotificationsPage => ({
    accounts: [{ ...account(by), displayName: `${by} ${content}` }],
    statuses: [post(content, favourited)],
    notificationGroups: [g(`ungrouped-${id}`, 'mention', id, id, [by])],
  })

  it('a superseded load writes nothing to the shared caches', async () => {
    // The client is alice's: her copies carry her flags.
    activeUserKey.value = 'alice@example.social' as never
    let release!: (p: GroupedNotificationsPage) => void
    fetchGroupedNotifications.mockReturnValueOnce(new Promise((r) => { release = r }))
    const store = createNotificationsStore({ clientSource: () => client() })
    const stale = store.load()
    fetchGroupedNotifications.mockResolvedValueOnce(pageWith('2', 'new', false, 'bob'))
    await store.load()
    release(pageWith('1', 'stale', true, 'bob'))
    await stale
    expect(store.groups.value.map((x) => x.key)).toEqual(['ungrouped-2'])
    expect(statusCache.value.get('s1')).toMatchObject({ content: 'new', favourited: false })
    expect(store.groups.value[0]!.status).toMatchObject({ content: 'new', favourited: false })
    expect(accountCache.value.get('bob')?.displayName).toBe('bob new')
  })

  it('a superseded Load older writes nothing to the shared caches', async () => {
    // The client is alice's: her copies carry her flags.
    activeUserKey.value = 'alice@example.social' as never
    fetchGroupedNotifications.mockResolvedValueOnce(pageWith('9', 'new', false, 'bob'))
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    let release!: (p: GroupedNotificationsPage) => void
    fetchGroupedNotifications.mockReturnValueOnce(new Promise((r) => { release = r }))
    const older = store.loadMore()
    fetchGroupedNotifications.mockResolvedValueOnce(pageWith('9', 'new', false, 'bob'))
    await store.load()
    release(pageWith('1', 'stale', true, 'bob'))
    await older
    expect(statusCache.value.get('s1')).toMatchObject({ content: 'new', favourited: false })
  })

  it('a reply held across an account change (A -> B -> A) writes nothing', async () => {
    activeUserKey.value = 'alice@example.social' as never
    let release!: (p: GroupedNotificationsPage) => void
    fetchGroupedNotifications.mockReturnValueOnce(new Promise((r) => { release = r }))
    const old = createNotificationsStore({ clientSource: () => client() })
    const pending = old.load()
    activeUserKey.value = 'bob@example.social' as never
    activeUserKey.value = 'alice@example.social' as never
    const fresh = createNotificationsStore({ clientSource: () => client() })
    fetchGroupedNotifications.mockResolvedValueOnce(pageWith('2', 'new', false, 'bob'))
    await fresh.load()
    release(pageWith('1', 'stale', true, 'bob'))
    await pending
    expect(old.groups.value).toEqual([])
    expect(statusCache.value.get('s1')).toMatchObject({ content: 'new', favourited: false })
    expect(fresh.groups.value[0]!.status).toMatchObject({ content: 'new', favourited: false })
  })

  it('a post changed in the cache shows in its group', async () => {
    fetchGroupedNotifications.mockResolvedValueOnce(page([g('favourite-s1', 'favourite', '5', '9', ['alice'])]))
    const store = createNotificationsStore({ clientSource: () => client() })
    await store.load()
    cacheStatus({ id: 's1', content: '<p>s1</p>', account: { id: 'me' }, favourited: true } as unknown as Status)
    expect(store.groups.value[0]!.status?.favourited).toBe(true)
  })
})
