import { lexicons, type AppBskyFeedDefs, type AppBskyNotificationListNotifications } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { CATCH_UP_MAX_PAGES, CATCH_UP_PAGE_SIZE, createBlueskyClient, type BlueskyAgent } from '../client.js'
import { reasonsFor } from '../map/notification.js'
import { fixture, moderationFor, READER } from './_helpers.js'

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))
vi.mock('../embeds.js', () => ({ mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, recordCard: null, quote: null })) }))

type Raw = AppBskyNotificationListNotifications.Notification
type RawPage = { cursor?: string; notifications: Raw[] }

const basePost = () => fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json').feed[0]!.post
const page = () => fixture<RawPage>('notifications-page.json')
const ALICE_POST = 'at://did:plc:alice/app.bsky.feed.post/3lalicepost1'
const CAROL_REPLY = 'at://did:plc:carol/app.bsky.feed.post/3lcreply1'

// The AppView answers getPosts with every URI it knows, in any order.
function postView(uri: string): AppBskyFeedDefs.PostView {
  return { ...basePost(), uri, cid: `cid-${uri}`, $type: 'app.bsky.feed.defs#postView' }
}

function setup(opts: { missing?: string[] } = {}) {
  const missing = new Set(opts.missing ?? [])
  const agent = {
    did: 'did:plc:alice',
    getPosts: vi.fn(async ({ uris }: { uris: string[] }) => ({ data: { posts: uris.filter((u) => !missing.has(u)).map(postView) } })),
    listNotifications: vi.fn(async (_: unknown) => ({ data: page() as RawPage })),
    countUnreadNotifications: vi.fn(async (_: unknown) => ({ data: { count: 3 } })),
    updateSeenNotifications: vi.fn(async (_: string) => ({ success: true })),
  }
  const onMapError = vi.fn()
  const onUnauthorized = vi.fn()
  const client = createBlueskyClient({
    userKey: READER,
    agent: agent as unknown as BlueskyAgent,
    moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    onMapError,
    onUnauthorized,
  })
  return { agent, client, onMapError, onUnauthorized }
}

function raw(n: number, reason = 'like', extra: Partial<Raw> = {}): Raw {
  return {
    uri: `at://did:plc:bob/app.bsky.feed.like/n${n}`, cid: `c${n}`,
    author: { did: 'did:plc:bob', handle: 'bob.example.com', labels: [] },
    reason, reasonSubject: ALICE_POST, record: {}, isRead: true,
    indexedAt: new Date(Date.UTC(2026, 10, 7, 12) - n * 60_000).toISOString(),
    ...extra,
  } as Raw
}

describe('fetchNotifications: the reasons', () => {
  it('the fixture is a valid AppView answer (the SDK checks every one)', () => {
    expect(() => lexicons.assertValidXrpcOutput('app.bsky.notification.listNotifications', page())).not.toThrow()
  })

  it('maps like, reply, follow and repost, and skips a reason it does not know', async () => {
    const { client } = setup()
    const res = await client.fetchNotifications()
    expect(res.map((n) => [n.type, n.bluesky?.reason])).toEqual([
      ['favourite', 'like'], ['mention', 'reply'], ['follow', 'follow'], ['reblog', 'repost'],
    ])
    const [like, reply, follow, repost] = res
    // A like and a repost carry the post they are about; a reply is its post.
    expect(like!.status?.id).toBe(ALICE_POST)
    expect(repost!.status?.id).toBe(ALICE_POST)
    expect(reply!.status?.id).toBe(CAROL_REPLY)
    expect(follow!.status ?? null).toBeNull()
    expect(like).toMatchObject({
      id: 'at://did:plc:bob/app.bsky.feed.like/3lblike1',
      createdAt: '2026-11-07T12:00:00.000Z',
      groupKey: 'at://did:plc:bob/app.bsky.feed.like/3lblike1',
      account: { id: 'did:plc:bob', acct: 'bob.example.com' },
      bluesky: {
        uri: 'at://did:plc:bob/app.bsky.feed.like/3lblike1', reason: 'like', reasonSubject: ALICE_POST,
        indexedAt: '2026-11-07T12:00:00.000Z', isRead: false,
      },
    })
  })

  it('gives each post provenance: the network, the reader as viewerOf, and its moderation', async () => {
    const { client } = setup()
    const [like] = await client.fetchNotifications()
    expect(like!.status!.bluesky).toMatchObject({ viewerOf: READER, uri: ALICE_POST })
    expect(like!.status!.bluesky!.moderation.contexts.contentList.reasons[0]!.source).toBe(ALICE_POST)
    expect(like!.account.bluesky!.moderation!.contexts.profileList.reasons[0]!.source).toBe('did:plc:bob')
  })

  it.each(['like-via-repost', 'repost-via-repost', 'starterpack-joined', 'verified', 'unverified', 'subscribed-post', 'contact-match', 'a-reason-from-later',
    // Names of Object members: never read from the prototype.
    'constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'skips %s and never throws', async (reason) => {
      const { agent, client } = setup()
      agent.listNotifications.mockResolvedValue({ data: { cursor: 'c', notifications: [raw(1, reason)] } })
      const res = await client.fetchNotifications()
      expect(res).toHaveLength(0)
      // Skipped is not the end.
      expect(res.nextCursor).toBe('c')
    })

  it('reasonsFor never reads a type from the prototype', () => {
    expect(reasonsFor(['constructor', 'toString', '__proto__'])).toEqual([])
    expect(reasonsFor(['mention'])).toEqual(['mention', 'reply', 'quote'])
  })

  it('skips a like with no subject, one whose post is gone, and one with no valid time', async () => {
    const { agent, client } = setup({ missing: ['at://did:plc:alice/app.bsky.feed.post/gone'] })
    agent.listNotifications.mockResolvedValue({ data: { notifications: [
      raw(1, 'like', { reasonSubject: undefined }),
      raw(2, 'like', { reasonSubject: 'at://did:plc:alice/app.bsky.feed.post/gone' }),
      raw(3, 'like', { indexedAt: 'not a time' }),
      raw(4, 'follow'),
    ] } })
    const res = await client.fetchNotifications()
    expect(res.map((n) => n.id)).toEqual([raw(4).uri])
  })

  it('drops one notification whose mapper throws, not the page', async () => {
    const { agent, client, onMapError } = setup()
    const author = Object.defineProperty({}, 'did', { get() { throw new Error('bad data') } })
    const bad = raw(1, 'follow', { author: author as Raw['author'] })
    agent.listNotifications.mockResolvedValue({ data: { notifications: [bad, raw(2, 'follow')] } })
    const res = await client.fetchNotifications()
    expect(res.map((n) => n.id)).toEqual([raw(2).uri])
    expect(onMapError).toHaveBeenCalledWith(expect.anything(), bad.uri)
  })

  it('reads each post once, 25 URIs per request', async () => {
    const { agent, client } = setup()
    const many = Array.from({ length: 30 }, (_, i) => raw(i, 'mention', {
      uri: `at://did:plc:bob/app.bsky.feed.post/m${i}`,
    }))
    agent.listNotifications.mockResolvedValue({ data: { notifications: [...many, raw(99, 'like'), raw(98, 'repost')] } })
    const res = await client.fetchNotifications()
    expect(res).toHaveLength(32)
    const asked = agent.getPosts.mock.calls.map(([q]) => q.uris)
    expect(asked.map((u) => u.length)).toEqual([25, 6])
    expect(new Set(asked.flat()).size).toBe(31)
  })
})

describe('fetchNotifications: filters, paging, seen hint', () => {
  it('sends no reasons for All; Mentions asks for mention, reply and quote', async () => {
    const { agent, client } = setup()
    await client.fetchNotifications({ types: [] })
    expect(agent.listNotifications).toHaveBeenLastCalledWith({})
    await client.fetchNotifications({ types: ['mention'], cursor: 'abc', limit: 40 })
    expect(agent.listNotifications).toHaveBeenLastCalledWith({ reasons: ['mention', 'reply', 'quote'], cursor: 'abc', limit: 40 })
  })

  it('passes the cursor back as it came; an empty AppView page ends the list', async () => {
    const { agent, client } = setup()
    expect((await client.fetchNotifications()).nextCursor).toBe('2026-11-07T10:00:00.000Z')
    agent.listNotifications.mockResolvedValue({ data: { cursor: 'more', notifications: [] } })
    expect((await client.fetchNotifications()).nextCursor).toBeNull()
    agent.listNotifications.mockResolvedValue({ data: { notifications: [raw(1, 'follow')] } })
    expect((await client.fetchNotifications()).nextCursor).toBeNull()
  })

  it('says the newest time it read, skipped ones included, and whether any was unread', async () => {
    const { agent, client } = setup()
    expect((await client.fetchNotifications()).bluesky).toEqual({
      newestAt: '2026-11-07T12:00:00.000Z', newestUri: 'at://did:plc:bob/app.bsky.feed.like/3lblike1', unread: true,
    })
    // The newest one is a reason Caribou skips: its time still counts.
    agent.listNotifications.mockResolvedValue({ data: { notifications: [
      raw(0, 'verified', { isRead: false }), raw(1, 'follow'),
    ] } })
    const res = await client.fetchNotifications()
    expect(res).toHaveLength(1)
    // The raw top is the skipped one: a new one there changes the anchor.
    expect(res.bluesky).toEqual({ newestAt: raw(0).indexedAt, newestUri: raw(0).uri, unread: true })
    agent.listNotifications.mockResolvedValue({ data: { notifications: [] } })
    expect((await client.fetchNotifications()).bluesky).toEqual({ newestAt: null, newestUri: null, unread: false })
  })
})

describe('fetchNotifications: catch-up (sinceId)', () => {
  function paged(pages: number) {
    return vi.fn(async ({ cursor }: { cursor?: string }) => {
      const i = cursor ? Number(cursor) : 0
      const notifications = i < pages
        ? Array.from({ length: CATCH_UP_PAGE_SIZE }, (_, k) => raw(i * CATCH_UP_PAGE_SIZE + k, 'follow'))
        : []
      return { data: { notifications, ...(i + 1 < pages ? { cursor: String(i + 1) } : {}) } }
    })
  }

  it('answers what is above the known top, across pages, with a null cursor', async () => {
    const { agent, client } = setup()
    agent.listNotifications = paged(3)
    const top = CATCH_UP_PAGE_SIZE + 2
    const res = await client.fetchNotifications({ sinceId: raw(top).uri })
    expect(res).toHaveLength(top)
    expect(res.nextCursor).toBeNull()
    expect(agent.listNotifications).toHaveBeenCalledTimes(2)
    expect(agent.listNotifications).toHaveBeenNthCalledWith(1, { limit: CATCH_UP_PAGE_SIZE })
  })

  it('meets a known top that Caribou skips (matched before the skip)', async () => {
    const { agent, client } = setup()
    agent.listNotifications.mockResolvedValue({ data: { cursor: 'x', notifications: [raw(0, 'follow'), raw(1, 'verified')] } })
    const res = await client.fetchNotifications({ sinceId: raw(1).uri })
    expect(res.map((n) => n.id)).toEqual([raw(0).uri])
    expect(res.nextCursor).toBeNull()
  })

  it('a gap: not met in 3 pages, answers all it read and the cursor after them', async () => {
    const { agent, client } = setup()
    agent.listNotifications = paged(5)
    const res = await client.fetchNotifications({ sinceId: 'at://did:plc:bob/app.bsky.feed.like/unknown' })
    expect(res).toHaveLength(CATCH_UP_MAX_PAGES * CATCH_UP_PAGE_SIZE)
    expect(res.nextCursor).toBe(String(CATCH_UP_MAX_PAGES))
  })

  // The anchor was deleted (an unlike, an unfollow): its URI is gone, so
  // the catch-up stops at the first one older than its time.
  const GONE = 'at://did:plc:bob/app.bsky.feed.like/deleted'

  it('a deleted anchor on a small account: one page read, nothing repeated, the end', async () => {
    const { agent, client } = setup()
    agent.listNotifications = paged(1)
    // The anchor sat between n2 and n3.
    const sinceAt = new Date(Date.parse(raw(2).indexedAt) - 30_000).toISOString()
    for (let poll = 0; poll < 3; poll++) {
      const res = await client.fetchNotifications({ sinceId: GONE, sinceAt })
      expect(res.map((x) => x.id)).toEqual([raw(0).uri, raw(1).uri, raw(2).uri])
      expect(res.nextCursor).toBeNull()
    }
    expect(agent.listNotifications).toHaveBeenCalledTimes(3)
  })

  it('a deleted anchor on a large account: no gap, nothing new', async () => {
    const { agent, client } = setup()
    agent.listNotifications = paged(8)
    // The anchor was n0's neighbour at n0's time: n0 (known to the store) is read, nothing else.
    const res = await client.fetchNotifications({ sinceId: GONE, sinceAt: raw(0).indexedAt })
    expect(res.map((x) => x.id)).toEqual([raw(0).uri])
    expect(res.nextCursor).toBeNull()
    expect(agent.listNotifications).toHaveBeenCalledTimes(1)
  })

  it('one at the same time as the anchor is read (the store drops the known ones)', async () => {
    const { agent, client } = setup()
    const same = raw(1, 'follow', { indexedAt: raw(0).indexedAt, uri: 'at://did:plc:bob/app.bsky.graph.follow/same' })
    agent.listNotifications.mockResolvedValue({ data: { notifications: [same, raw(0, 'follow'), raw(2, 'follow')] } })
    const res = await client.fetchNotifications({ sinceId: GONE, sinceAt: raw(0).indexedAt })
    expect(res.map((x) => x.id)).toEqual([same.uri, raw(0).uri])
    expect(res.nextCursor).toBeNull()
  })

  it('not met but the list ended: a null cursor', async () => {
    const { agent, client } = setup()
    agent.listNotifications = paged(1)
    const res = await client.fetchNotifications({ sinceId: 'at://did:plc:bob/app.bsky.feed.like/unknown' })
    expect(res).toHaveLength(CATCH_UP_PAGE_SIZE)
    expect(res.nextCursor).toBeNull()
  })
})

describe('getUnreadCount and updateSeen', () => {
  it('reads the server count; a missing or bad one is 0', async () => {
    const { agent, client } = setup()
    expect(await client.getUnreadCount!()).toBe(3)
    expect(agent.countUnreadNotifications).toHaveBeenCalledWith({})
    agent.countUnreadNotifications.mockResolvedValue({ data: {} as { count: number } })
    expect(await client.getUnreadCount!()).toBe(0)
    agent.countUnreadNotifications.mockResolvedValue({ data: { count: -2 } })
    expect(await client.getUnreadCount!()).toBe(0)
  })

  it('sends updateSeen every time it is called: a write is never deduped', async () => {
    const { agent, client } = setup()
    await Promise.all([client.updateSeen!('2026-11-07T12:00:00.000Z'), client.updateSeen!('2026-11-07T12:00:00.000Z')])
    expect(agent.updateSeenNotifications).toHaveBeenCalledTimes(2)
    expect(agent.updateSeenNotifications).toHaveBeenCalledWith('2026-11-07T12:00:00.000Z')
  })

  it('a 401 on either is unauthorized and tells the session', async () => {
    const { agent, client, onUnauthorized } = setup()
    const err = Object.assign(new Error('expired'), { status: 401, error: 'ExpiredToken' })
    agent.updateSeenNotifications.mockRejectedValue(err)
    await expect(client.updateSeen!('2026-11-07T12:00:00.000Z')).rejects.toMatchObject({ code: 'unauthorized' })
    agent.countUnreadNotifications.mockRejectedValue(err)
    await expect(client.getUnreadCount!()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalledTimes(2)
  })

  it('has no server groups', async () => {
    const { client } = setup()
    await expect(client.fetchGroupedNotifications()).rejects.toMatchObject({ code: 'not_found' })
    await expect(client.fetchNotificationGroupAccounts('k')).rejects.toMatchObject({ code: 'not_found' })
  })
})
