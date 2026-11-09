import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Capabilities, CaribouClient, FetchNotificationsParams, Notification, NotificationPage, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, blueskyUserKey, lastSeenNotificationAt, resetBlueskySeen, setBlueskyDriver, statusCache,
  unreadNotificationCount, users, type BlueskyDriver, type UserSession,
} from '@beatzball/caribou-state'
import { createBlueskyClient, type BlueskyAgent } from '@beatzball/caribou-bluesky-client/browser'
import { toUserKey } from '@beatzball/caribou-auth'
import '../caribou-notifications.js'
import '../caribou-status-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import type { CaribouNotifications } from '../caribou-notifications.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded, setBlueskyReader } from '../_bluesky-moderation.js'

// The notifications page for a Bluesky account (state README,
// "Notifications"): grouped by the store, links without a host, and
// updateSeen at the moment a Mastodon list moves its marker.

const CAPS = { network: 'bluesky', readLagMs: 60_000, edit: false } as unknown as Capabilities
const alice = blueskyUserKey('did:plc:alice')
const POST = 'at://did:plc:alice/app.bsky.feed.post/p1'

// Bluesky's own labeler, the one every reader subscribes to.
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'

// The reader veil's inputs, loaded for Alice (README, "Bluesky views").
function readerLoaded() {
  setBlueskyReader({
    userKey: alice,
    prefs: { adultContentEnabled: false, labels: {}, labelers: [], mutedWords: [], hiddenPosts: [] },
    labelDefs: { [BSKY_LABELER]: [] },
  })
}

const CONTEXTS = ['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView']
type Ui = { filter: boolean; blur: boolean; alert: boolean; inform: boolean; noOverride: boolean; reasons: { label: string; source: string; name: string }[] }
const CLEAN: Ui = { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }

// The reader's decision for an account, every context present. `over`
// changes some contexts.
function decision(over: Partial<Record<string, Partial<Ui>>> = {}) {
  return {
    contexts: Object.fromEntries(CONTEXTS.map((c) => [c, { ...CLEAN, ...over[c] }])),
    // Fetched as the reader with Bluesky's labeler covered: settled.
    labelersCovered: [BSKY_LABELER],
  }
}

function account(did: string, handle: string, name: string, moderation = decision()) {
  return {
    id: did, acct: handle, username: handle, displayName: name, avatar: `https://cdn.example.test/${handle}.jpg`,
    avatarStatic: `https://cdn.example.test/${handle}.jpg`, url: `https://bsky.app/profile/${did}`,
    bluesky: { did, handleInvalid: false, moderation },
  }
}

const BOB = account('did:plc:bob', 'bob.example.com', 'Bob')
const CAROL = account('did:plc:carol', 'carol.example.com', 'Carol')

function post(uri: string): Status {
  return {
    id: uri, uri, url: null, content: '<p>hello</p>', createdAt: '2026-11-07T08:00:00.000Z',
    account: account('did:plc:alice', 'alice.example.com', 'Alice'), inReplyToId: null,
    mediaAttachments: [], emojis: [], mentions: [], tags: [],
    bluesky: {
      uri, cid: 'c', likeUri: null, repostUri: null, replyRef: null, replyDisabled: false, embeddingDisabled: false,
      labels: [], moderation: decision(), viewerOf: alice,
    },
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
  await _testOnlyVeilLoaded()
  for (let i = 0; i < 3; i++) {
    await flush()
    await el.updateComplete
  }
  return el
}

const rows = (el: CaribouNotifications) => [...el.shadowRoot!.querySelectorAll('ul.rows > li')]
const lineText = (li: Element) => li.querySelector('.line > span')?.textContent?.replace(/\s+/g, ' ').trim()

beforeEach(() => {
  setBlueskyDriver(driver)
  _testOnlyResetBlueskyVeil()
  readerLoaded()
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

describe('caribou-notifications, Bluesky: authors, provenance, Show all, an empty list', () => {
  const SPOILER = { blur: true, reasons: [{ label: 'spoiler', source: 'did:plc:labeler', name: 'Spoiler' }] }

  it('a filtered author leaves the row; a covered one has no name or link; a blurred avatar is blurred', async () => {
    const HIDDEN = account('did:plc:hid', 'hid.example.com', 'Hidden', decision({ contentList: { filter: true } }))
    const COVERED = account('did:plc:cov', 'cov.example.com', 'Covered', decision({ contentList: SPOILER }))
    const BLURRY = account('did:plc:blur', 'blur.example.com', 'Blurry', decision({ avatar: { blur: true } }))
    fetchNotifications.mockResolvedValue(page([
      // A like from a hidden and a clean author: only the clean one is named.
      n(1, 'favourite', '2026-11-07T12:00:00.000Z', HIDDEN),
      n(2, 'favourite', '2026-11-07T11:00:00.000Z', BOB),
      // A follow from a hidden author alone: the row goes.
      n(3, 'follow', '2026-11-07T10:00:00.000Z', HIDDEN),
      // A follow from a covered author: no name, a reason.
      n(4, 'follow', '2026-11-06T10:00:00.000Z', COVERED),
      // A like from an author whose avatar is blurred.
      n(5, 'favourite', '2026-11-05T12:00:00.000Z', BLURRY),
      n(6, 'favourite', '2026-11-05T11:00:00.000Z', CAROL),
    ], { newestAt: '2026-11-07T12:00:00.000Z', unread: false }))
    const el = await mount()
    const list = rows(el)
    expect(list.map(lineText)).toEqual([
      'Bob liked your post',
      'Someone (Content warning: Spoiler) followed you',
      'Blurry and Carol liked your post',
    ])
    expect(el.shadowRoot!.innerHTML).not.toContain('Hidden')
    expect(el.shadowRoot!.innerHTML).not.toContain('hid.example.com')
    expect(list[1]!.querySelector('.line a')).toBeNull()
    expect(el.shadowRoot!.innerHTML).not.toContain('cov.example.com')
    const faces = [...list[2]!.querySelectorAll('.avatars img')]
    expect(faces.map((img) => img.classList.contains('blurred'))).toEqual([true, false])
  })

  it('"Show all" on a Bluesky group never asks for the server group', async () => {
    fetchNotifications.mockResolvedValue(page([
      n(1, 'favourite', '2026-11-07T12:00:00.000Z', BOB),
      n(2, 'favourite', '2026-11-07T11:00:00.000Z', CAROL),
    ], { newestAt: '2026-11-07T12:00:00.000Z', unread: false }))
    const groupAccounts = vi.fn()
    const restore = driver.restore
    driver.restore = async (s, hooks) => Object.assign(await restore(s, hooks), { fetchNotificationGroupAccounts: groupAccounts })
    try {
      const el = await mount()
      ;(rows(el)[0]!.querySelector('button.expand') as HTMLButtonElement).click()
      await flush()
      await el.updateComplete
      expect([...rows(el)[0]!.querySelectorAll('.who li')].map((li) => li.textContent?.trim())).toEqual(['Bob', 'Carol'])
      expect(groupAccounts).not.toHaveBeenCalled()
    } finally {
      driver.restore = restore
    }
  })

  it('an empty list with a cursor says why, and Load older that ends it moves focus to the end notice', async () => {
    fetchNotifications.mockImplementation(async (p) => p?.cursor
      ? page([], { newestAt: null, unread: false }, null)
      : page([], { newestAt: null, unread: false }, 'more'))
    const el = await mount()
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('.more caribou-button')).not.toBeNull())
    expect(el.shadowRoot!.querySelector('.notice')?.textContent).toContain('Nothing to show here yet')
    ;(el.shadowRoot!.querySelector('.more caribou-button') as HTMLElement).click()
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('.more')).toBeNull())
    await el.updateComplete
    const end = el.shadowRoot!.querySelector('.notice')!
    expect(end.textContent).toContain('No notifications yet.')
    expect(el.shadowRoot!.activeElement).toBe(end)
  })

  it('a Mastodon reader gets no live buttons on a Bluesky post from the list', async () => {
    fetchNotifications.mockResolvedValue(page([n(1, 'mention', '2026-11-07T12:00:00.000Z')], { newestAt: '2026-11-07T12:00:00.000Z', unread: false }))
    const el = await mount()
    await vi.waitFor(() => expect(statusCache.value.get(POST)?.bluesky?.viewerOf).toBe(alice))
    el.remove()
    // A Mastodon account becomes active. It sees the post as a public copy
    // (a decision for no reader), so the card is not covered and draws its
    // actions; they must not be live.
    const masto = toUserKey('carol', 'example.social')
    users.value = new Map([...users.value, [masto, {
      userKey: masto, server: 'example.social', token: 'T', vapidKey: '', generation: 'M', account: null, createdAt: 1,
    }]])
    activeUserKey.value = masto
    const cached = statusCache.value.get(POST)!
    // Its own public decision (made for no reader), as page data has.
    const publicCopy = { ...cached, bluesky: { ...cached.bluesky!, viewerOf: null, moderation: decision() as never } }
    statusCache.value = new Map([...statusCache.value, [POST, publicCopy]])
    const card = document.createElement('caribou-status-card') as CaribouStatusCard
    card.status = publicCopy
    card.instance = 'example.social'
    document.body.appendChild(card)
    for (let i = 0; i < 4; i++) { await _testOnlyVeilLoaded(); await flush(); await card.updateComplete }
    expect(card.shadowRoot!.querySelector('.cover')).toBeNull()
    const favourite = vi.spyOn(activeClient.value!, 'favourite')
    const buttons = [...card.shadowRoot!.querySelectorAll('.actions caribou-icon-button')] as (HTMLElement & { updateComplete: Promise<unknown> })[]
    expect(buttons.length).toBeGreaterThanOrEqual(4)
    for (const b of buttons) {
      await b.updateComplete
      const inner = b.shadowRoot!.querySelector('button')!
      expect(inner.getAttribute('aria-disabled')).toBe('true')
      inner.click()
    }
    expect(favourite).not.toHaveBeenCalled()
  })
})

describe('caribou-notifications, Bluesky: reasons named like Object members, through the real client', () => {
  it('skips constructor, toString and __proto__ and renders the rest', async () => {
    const author = { did: 'did:plc:bob', handle: 'bob.example.com', displayName: 'Bob', labels: [] }
    const raw = (i: number, reason: string) => ({
      uri: `at://did:plc:bob/app.bsky.feed.like/r${i}`, cid: 'c', author, reason, reasonSubject: POST,
      record: {}, isRead: true, indexedAt: `2026-11-07T1${i}:00:00.000Z`, labels: [],
    })
    const agent = {
      did: 'did:plc:alice',
      listNotifications: vi.fn(async () => ({ data: { notifications: [
        raw(5, 'constructor'), raw(4, 'toString'), raw(3, '__proto__'), raw(2, 'follow'),
      ] } })),
      getPosts: vi.fn(async ({ uris }: { uris: string[] }) => ({ data: { posts: uris.map((uri) => ({
        uri, cid: 'c', author: { did: 'did:plc:alice', handle: 'alice.example.com', labels: [] },
        record: { text: 'hi', createdAt: '2026-11-07T08:00:00.000Z' }, indexedAt: '2026-11-07T08:00:00.000Z',
        labels: [], $type: 'app.bsky.feed.defs#postView',
      })) } })),
    }
    const restore = driver.restore
    driver.restore = async (s) => createBlueskyClient({
      userKey: s.userKey, agent: agent as unknown as BlueskyAgent,
      moderation: { post: () => decision() as never, profile: () => decision() as never },
    })
    try {
      const el = document.createElement('caribou-notifications') as CaribouNotifications
      document.body.appendChild(el)
      await vi.waitFor(() => expect(rows(el)).toHaveLength(1))
      expect(lineText(rows(el)[0]!)).toBe('Bob followed you')
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull()
    } finally {
      driver.restore = restore
    }
  })
})

describe('caribou-notifications, Bluesky: the veil, notices and focus', () => {
  const ended = { newestAt: null, unread: false }

  it('an author whose decision is not settled yet is covered, with a blurred face', async () => {
    _testOnlyResetBlueskyVeil()
    // No reader loaded: nothing can be settled.
    fetchNotifications.mockResolvedValue(page([n(1, 'follow', '2026-11-07T12:00:00.000Z', BOB)], ended))
    const el = await mount()
    expect(lineText(rows(el)[0]!)).toBe('Someone (checking your moderation settings) followed you')
    expect(el.shadowRoot!.innerHTML).not.toContain('bob.example.com')
    // Once the reader loads, the name shows.
    readerLoaded()
    await vi.waitFor(() => expect(lineText(rows(el)[0]!)).toBe('Bob followed you'))
  })

  it('an author with no decision is covered (fail closed), and a covered face is blurred', async () => {
    const NONE = { ...account('did:plc:none', 'none.example.com', 'None'), bluesky: { did: 'did:plc:none', handleInvalid: false } }
    fetchNotifications.mockResolvedValue(page([
      n(1, 'favourite', '2026-11-07T12:00:00.000Z', NONE as never),
      n(2, 'favourite', '2026-11-07T11:00:00.000Z', CAROL),
    ], ended))
    const el = await mount()
    expect(lineText(rows(el)[0]!)).toBe('Someone (Content warning (moderation failed)) and Carol liked your post')
    const faces = [...rows(el)[0]!.querySelectorAll('.avatars img')]
    expect(faces.map((img) => img.classList.contains('blurred'))).toEqual([true, false])
  })

  it('a covered author\'s face is blurred, even when its avatar decision is clean', async () => {
    const COVERED = account('did:plc:cov', 'cov.example.com', 'Covered', decision({
      contentList: { blur: true, reasons: [{ label: 'spoiler', source: 'did:plc:labeler', name: 'Spoiler' }] },
    }))
    fetchNotifications.mockResolvedValue(page([
      n(1, 'favourite', '2026-11-07T12:00:00.000Z', COVERED),
      n(2, 'favourite', '2026-11-07T11:00:00.000Z', CAROL),
    ], ended))
    const el = await mount()
    const faces = [...rows(el)[0]!.querySelectorAll('.avatars img')]
    expect(faces.map((img) => img.classList.contains('blurred'))).toEqual([true, false])
  })

  it('a list whose every author is filtered says it is empty, from what is left', async () => {
    const HIDDEN = account('did:plc:hid', 'hid.example.com', 'Hidden', decision({ contentList: { filter: true } }))
    fetchNotifications.mockResolvedValue(page([n(1, 'follow', '2026-11-07T12:00:00.000Z', HIDDEN)], ended))
    const el = await mount()
    expect(rows(el)).toHaveLength(0)
    expect(el.shadowRoot!.querySelector('ul.rows')).toBeNull()
    expect(el.shadowRoot!.querySelector('.notice')?.textContent).toContain('No notifications yet.')
  })

  it('a list with rows: Load older that ends it shows "No older notifications." and focuses it', async () => {
    fetchNotifications.mockImplementation(async (p) => p?.cursor
      ? page([], ended, null)
      : page([n(1, 'follow', '2026-11-07T12:00:00.000Z', BOB)], ended, 'more'))
    const el = await mount()
    const more = el.shadowRoot!.querySelector('.more caribou-button') as HTMLElement
    more.focus()
    more.click()
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('.notice.end')).not.toBeNull())
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.notice.end')!.textContent).toBe('No older notifications.')
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('.notice.end'))
  })

  it('focus the reader moved while Load older was out stays where it is', async () => {
    let release!: (p: NotificationPage) => void
    fetchNotifications.mockImplementation(async (p) => p?.cursor
      ? new Promise<NotificationPage>((r) => { release = r })
      : page([n(1, 'follow', '2026-11-07T12:00:00.000Z', BOB)], ended, 'more'))
    const el = await mount()
    const more = el.shadowRoot!.querySelector('.more caribou-button') as HTMLElement
    more.focus()
    more.click()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const link = rows(el)[0]!.querySelector('.line a') as HTMLAnchorElement
    link.focus()
    release(page([], ended, null))
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('.notice.end')).not.toBeNull())
    await el.updateComplete
    await flush()
    expect(el.shadowRoot!.activeElement).toBe(link)
  })

  it('Retry starts over: the end notice from an earlier Load older goes', async () => {
    let fail = false
    fetchNotifications.mockImplementation(async (p) => {
      if (fail) throw new Error('offline')
      return p?.cursor ? page([], ended, null) : page([], ended, 'more')
    })
    const el = await mount()
    ;(el.shadowRoot!.querySelector('.more caribou-button') as HTMLElement).click()
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('.notice.end')).not.toBeNull())
    // A load fails: the list shows Retry.
    fail = true
    ;(el as unknown as { onRetry: () => void }).onRetry()
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"] caribou-button')).not.toBeNull())
    fail = false
    fetchNotifications.mockImplementation(async () => page([], ended, null))
    ;(el.shadowRoot!.querySelector('[role="alert"] caribou-button') as HTMLElement).click()
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull())
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.notice')?.textContent).toContain('No notifications yet.')
    expect(el.shadowRoot!.querySelector('.notice.end')).toBeNull()
  })

  it('a real poll with nothing new does not send updateSeen again', async () => {
    const pollMs = (customElements.get('caribou-notifications') as unknown as { pollMs: number }).pollMs
    ;(customElements.get('caribou-notifications') as unknown as { pollMs: number }).pollMs = 20
    try {
      fetchNotifications.mockImplementation(async (p) => p?.sinceId
        ? page([], { newestAt: null, unread: false }, null)
        : page([n(1, 'mention', '2026-11-07T12:00:00.000Z')], { newestAt: '2026-11-07T12:00:00.000Z', unread: true }))
      await mount()
      await vi.waitFor(() => expect(updateSeen).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(fetchNotifications.mock.calls.filter(([p]) => p?.sinceId).length).toBeGreaterThanOrEqual(2))
      await flush()
      expect(updateSeen).toHaveBeenCalledTimes(1)
    } finally {
      ;(customElements.get('caribou-notifications') as unknown as { pollMs: number }).pollMs = pollMs
    }
  })
})
