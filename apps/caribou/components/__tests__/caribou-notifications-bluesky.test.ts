import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Capabilities, CaribouClient, FetchNotificationsParams, Notification, NotificationPage, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeUserKey, blueskyUserKey, lastSeenNotificationAt, resetBlueskySeen, setBlueskyDriver, statusCache,
  unreadNotificationCount, users, type BlueskyDriver, type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-notifications.js'
import type { CaribouNotifications } from '../caribou-notifications.js'

// The notifications page for a Bluesky account (state README,
// "Notifications"): grouped by the store, links without a host, and
// updateSeen at the moment a Mastodon list moves its marker.

const CAPS = { network: 'bluesky', readLagMs: 60_000, edit: false } as unknown as Capabilities
const alice = blueskyUserKey('did:plc:alice')
const POST = 'at://did:plc:alice/app.bsky.feed.post/p1'

function account(did: string, handle: string, name: string) {
  return {
    id: did, acct: handle, username: handle, displayName: name, avatar: '', avatarStatic: '', url: `https://bsky.app/profile/${did}`,
    bluesky: { did, handleInvalid: false },
  }
}

const BOB = account('did:plc:bob', 'bob.example.com', 'Bob')
const CAROL = account('did:plc:carol', 'carol.example.com', 'Carol')

function post(uri: string): Status {
  return {
    id: uri, uri, url: null, content: '<p>hello</p>', createdAt: '2026-11-07T08:00:00.000Z',
    account: account('did:plc:alice', 'alice.example.com', 'Alice'), inReplyToId: null,
    mediaAttachments: [], emojis: [], mentions: [], tags: [],
    bluesky: { uri, cid: 'c', likeUri: null, repostUri: null, viewerOf: alice },
  } as unknown as Status
}

function n(i: number, type: string, at: string, by = BOB, isRead = false): Notification {
  return {
    id: `at://${by.id}/app.bsky.feed.${type}/n${i}`, type, createdAt: at, groupKey: `g${i}`, account: by,
    ...(type === 'follow' ? {} : { status: post(POST) }),
    bluesky: { uri: `n${i}`, reason: type, reasonSubject: POST, indexedAt: at, isRead },
  } as unknown as Notification
}

function page(list: Notification[], hint: NotificationPage['bluesky'], nextCursor: string | null = null): NotificationPage {
  return Object.assign(list, { nextCursor, bluesky: hint })
}

const fetchNotifications = vi.fn<(p?: FetchNotificationsParams) => Promise<NotificationPage>>()
const updateSeen = vi.fn<(at: string) => Promise<void>>()
const getUnreadCount = vi.fn<() => Promise<number>>()

const driver: BlueskyDriver = {
  capabilities: CAPS,
  timelineOrder: () => null,
  restore: async (s) => ({
    userKey: s.userKey, capabilities: CAPS, timelineOrder: () => null,
    fetchNotifications, updateSeen, getUnreadCount,
  }) as unknown as CaribouClient,
  signOut: async () => {},
}

function signIn() {
  const s: UserSession = {
    network: 'bluesky', userKey: alice, did: 'did:plc:alice', handle: 'alice.example.com',
    pds: 'https://pds.example.test', generation: 'G1', account: null, createdAt: 1,
  }
  users.value = new Map([[alice, s]])
  activeUserKey.value = alice
}

const flush = () => new Promise((r) => setTimeout(r, 0))

async function mount(): Promise<CaribouNotifications> {
  const el = document.createElement('caribou-notifications') as CaribouNotifications
  document.body.appendChild(el)
  await vi.waitFor(() => expect(fetchNotifications).toHaveBeenCalled())
  await flush()
  await el.updateComplete
  await flush()
  return el
}

const rows = (el: CaribouNotifications) => [...el.shadowRoot!.querySelectorAll('ul.rows > li')]
const lineText = (li: Element) => li.querySelector('.line > span')?.textContent?.replace(/\s+/g, ' ').trim()

beforeEach(() => {
  setBlueskyDriver(driver)
  resetBlueskySeen()
  fetchNotifications.mockReset()
  updateSeen.mockReset()
  updateSeen.mockResolvedValue()
  getUnreadCount.mockReset()
  getUnreadCount.mockResolvedValue(0)
  localStorage.clear()
  statusCache.value = new Map()
  unreadNotificationCount.value = 0
  signIn()
})

afterEach(() => {
  document.body.replaceChildren()
  setBlueskyDriver(null)
  users.value = new Map()
  activeUserKey.value = null
})

describe('caribou-notifications, Bluesky', () => {
  it('groups likes, says "liked" and "reposted", and links each account by its handle', async () => {
    fetchNotifications.mockResolvedValue(page([
      n(1, 'favourite', '2026-11-07T12:00:00.000Z', BOB),
      n(2, 'reblog', '2026-11-07T11:00:00.000Z', CAROL),
      n(3, 'favourite', '2026-11-07T10:00:00.000Z', CAROL),
      n(4, 'follow', '2026-11-07T09:00:00.000Z', BOB),
    ], { newestAt: '2026-11-07T12:00:00.000Z', unread: false }))
    const el = await mount()
    const list = rows(el)
    expect(list.map(lineText)).toEqual([
      'Bob and Carol liked your post', 'Carol reposted your post', 'Bob followed you',
    ])
    expect(list[0]!.querySelector('.line a')?.getAttribute('href')).toBe('/@bob.example.com')
    // The card has no instance: a Bluesky post has none.
    expect(list[0]!.querySelector('caribou-status-card')?.getAttribute('instance')).toBe('')
  })

  it('sends updateSeen once, with the newest time read, when the All list is on screen', async () => {
    unreadNotificationCount.value = 2
    fetchNotifications.mockResolvedValue(page([n(1, 'mention', '2026-11-07T12:00:00.000Z')], { newestAt: '2026-11-07T12:30:00.000Z', unread: true }))
    const el = await mount()
    await vi.waitFor(() => expect(updateSeen).toHaveBeenCalledTimes(1))
    expect(updateSeen).toHaveBeenCalledWith('2026-11-07T12:30:00.000Z')
    expect(lastSeenNotificationAt(alice)).toBe('2026-11-07T12:30:00.000Z')
    expect(unreadNotificationCount.value).toBe(0)
    // A poll with nothing new does not send it again.
    fetchNotifications.mockResolvedValue(page([], { newestAt: null, unread: false }))
    el.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(updateSeen).toHaveBeenCalledTimes(1)
  })

  it('does not send updateSeen from the Mentions list', async () => {
    fetchNotifications.mockResolvedValue(page([n(1, 'favourite', '2026-11-07T12:00:00.000Z')], { newestAt: '2026-11-07T12:00:00.000Z', unread: true }))
    const el = await mount()
    await vi.waitFor(() => expect(updateSeen).toHaveBeenCalledTimes(1))
    fetchNotifications.mockResolvedValue(page([n(2, 'mention', '2026-11-07T13:00:00.000Z')], { newestAt: '2026-11-07T13:00:00.000Z', unread: true }))
    const mentions = el.shadowRoot!.querySelector('caribou-button[data-filter="mentions"]') as HTMLElement
    mentions.click()
    await flush()
    await el.updateComplete
    await flush()
    expect(fetchNotifications).toHaveBeenLastCalledWith({ types: ['mention'] })
    expect(updateSeen).toHaveBeenCalledTimes(1)
  })

  it('does not send updateSeen when the list read nothing unread', async () => {
    fetchNotifications.mockResolvedValue(page([n(1, 'mention', '2026-11-07T12:00:00.000Z', BOB, true)], { newestAt: '2026-11-07T12:00:00.000Z', unread: false }))
    await mount()
    await flush()
    expect(updateSeen).not.toHaveBeenCalled()
  })

  it('an empty page with a cursor keeps Load older', async () => {
    fetchNotifications.mockResolvedValue(page([], { newestAt: null, unread: false }, 'more'))
    const el = await mount()
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('.more caribou-button')).not.toBeNull())
  })
})
