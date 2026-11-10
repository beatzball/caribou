import type { AppBskyFeedDefs } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { CATCH_UP_PAGE_SIZE, createBlueskyClient, type BlueskyAgent } from '../client.js'
import { fixture, moderationFor, READER } from './_helpers.js'

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))
vi.mock('../embeds.js', () => ({ mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, recordCard: null, quote: null })) }))

const basePost = () => fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json').feed[0]!.post
const post = (n: number | string): AppBskyFeedDefs.PostView =>
  ({ ...basePost(), uri: `at://did:plc:bob/app.bsky.feed.post/p${n}`, cid: `bafy${n}`, $type: 'app.bsky.feed.defs#postView' })
const entry = (n: number | string): AppBskyFeedDefs.FeedViewPost => ({ post: post(n) })

const CATS = 'at://did:plc:alice/app.bsky.feed.generator/cats'
const DOGS = 'at://did:plc:alice/app.bsky.feed.generator/dogs'

function generator(uri: string, name: string): AppBskyFeedDefs.GeneratorView {
  return {
    uri, cid: 'bafyg', did: 'did:web:feeds.example.com', displayName: name, description: `${name} only`,
    avatar: `https://cdn.example.com/${name}.jpg`, indexedAt: '2026-01-01T00:00:00.000Z',
    creator: { did: 'did:plc:alice', handle: 'alice.example.com' },
  }
}

function xrpcError(status: number, error: string, message = error) {
  return Object.assign(new Error(message), { status, error })
}

function setup() {
  const agent = {
    did: 'did:plc:reader',
    getTimeline: vi.fn(),
    getPreferences: vi.fn(),
    app: {
      bsky: {
        bookmark: { getBookmarks: vi.fn() },
        graph: { getMutes: vi.fn(), getBlocks: vi.fn() },
        feed: { getFeed: vi.fn(), getFeedGenerators: vi.fn() },
      },
    },
  }
  const onUnauthorized = vi.fn()
  const client = createBlueskyClient({
    userKey: READER,
    agent: agent as unknown as BlueskyAgent,
    moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    onUnauthorized,
  })
  return { agent, client, onUnauthorized }
}

const item = (id: string, type: string, value: string, pinned = true) => ({ id, type, value, pinned })

describe('blueskySavedFeeds', () => {
  it('keeps the stored order, Following and feeds, with names from getFeedGenerators', async () => {
    const { agent, client } = setup()
    agent.getPreferences.mockResolvedValue({ savedFeeds: [
      item('a', 'feed', DOGS),
      item('b', 'timeline', 'following'),
      item('c', 'feed', CATS, false),
    ] })
    agent.app.bsky.feed.getFeedGenerators.mockResolvedValue({ data: { feeds: [generator(CATS, 'Cats'), generator(DOGS, 'Dogs')] } })
    const feeds = await client.blueskySavedFeeds!()
    expect(agent.app.bsky.feed.getFeedGenerators).toHaveBeenCalledWith({ feeds: [DOGS, CATS] })
    expect(feeds).toEqual([
      { id: 'a', kind: 'feed', uri: DOGS, pinned: true, name: 'Dogs', description: 'Dogs only',
        avatar: 'https://cdn.example.com/Dogs.jpg', creator: 'alice.example.com', available: true },
      { id: 'b', kind: 'timeline', uri: '', pinned: true, name: 'Following', description: '', avatar: null, creator: null, available: true },
      { id: 'c', kind: 'feed', uri: CATS, pinned: false, name: 'Cats', description: 'Cats only',
        avatar: 'https://cdn.example.com/Cats.jpg', creator: 'alice.example.com', available: true },
    ])
  })

  it('leaves out lists, unknown types, bad URIs and repeats', async () => {
    const { agent, client } = setup()
    agent.getPreferences.mockResolvedValue({ savedFeeds: [
      item('a', 'list', 'at://did:plc:alice/app.bsky.graph.list/x'),
      item('b', 'starterpack', 'x'),
      item('c', 'feed', 'https://example.com/feed'),
      item('d', 'feed', 'at://did:plc:alice/app.bsky.feed.post/x'),
      item('e', 'feed', CATS),
      item('f', 'feed', CATS),
    ] })
    agent.app.bsky.feed.getFeedGenerators.mockResolvedValue({ data: { feeds: [generator(CATS, 'Cats')] } })
    expect((await client.blueskySavedFeeds!()).map((f) => f.id)).toEqual(['e'])
  })

  it('keeps a feed the AppView does not return, as not available, named by its rkey', async () => {
    const { agent, client } = setup()
    agent.getPreferences.mockResolvedValue({ savedFeeds: [item('a', 'feed', CATS)] })
    agent.app.bsky.feed.getFeedGenerators.mockResolvedValue({ data: { feeds: [] } })
    expect(await client.blueskySavedFeeds!()).toEqual([
      { id: 'a', kind: 'feed', uri: CATS, pinned: true, name: 'cats', description: '', avatar: null, creator: null, available: false },
    ])
  })

  it('asks for names 25 at a time, and not at all with no feeds', async () => {
    const { agent, client } = setup()
    const uris = Array.from({ length: 30 }, (_, i) => `at://did:plc:alice/app.bsky.feed.generator/f${i}`)
    agent.getPreferences.mockResolvedValue({ savedFeeds: uris.map((u, i) => item(String(i), 'feed', u)) })
    agent.app.bsky.feed.getFeedGenerators.mockImplementation(async ({ feeds }: { feeds: string[] }) =>
      ({ data: { feeds: feeds.map((u) => generator(u, u.split('/').pop()!)) } }))
    expect(await client.blueskySavedFeeds!()).toHaveLength(30)
    expect(agent.app.bsky.feed.getFeedGenerators.mock.calls.map(([q]) => q.feeds.length)).toEqual([25, 5])

    agent.app.bsky.feed.getFeedGenerators.mockClear()
    agent.getPreferences.mockResolvedValue({ savedFeeds: [item('b', 'timeline', 'following')] })
    expect(await client.blueskySavedFeeds!()).toHaveLength(1)
    expect(agent.app.bsky.feed.getFeedGenerators).not.toHaveBeenCalled()
  })

  it('fails when the prefs or the names fail; a 401 ends the session', async () => {
    const { agent, client, onUnauthorized } = setup()
    agent.getPreferences.mockRejectedValue(xrpcError(502, 'Bad'))
    await expect(client.blueskySavedFeeds!()).rejects.toMatchObject({ code: 'server_error' })
    agent.getPreferences.mockResolvedValue({ savedFeeds: [item('a', 'feed', CATS)] })
    agent.app.bsky.feed.getFeedGenerators.mockRejectedValue(xrpcError(401, 'AuthMissing'))
    await expect(client.blueskySavedFeeds!()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalled()
  })
})

describe('the SDK\'s methods keep their `this`', () => {
  it('calls getPreferences, getFeedGenerators and getFeed on their own objects', async () => {
    const { agent, client } = setup()
    const feedNs = {
      own: true,
      getFeed(this: { own?: boolean }) {
        if (!this?.own) throw new TypeError("Cannot read properties of undefined (reading '_client')")
        return Promise.resolve({ data: { feed: [entry(1)] } })
      },
      getFeedGenerators(this: { own?: boolean }) {
        if (!this?.own) throw new TypeError("Cannot read properties of undefined (reading '_client')")
        return Promise.resolve({ data: { feeds: [generator(CATS, 'Cats')] } })
      },
    }
    agent.app.bsky.feed = feedNs as never
    Object.assign(agent, {
      own: true,
      getPreferences(this: { own?: boolean }) {
        if (!this?.own) throw new TypeError('detached')
        return Promise.resolve({ savedFeeds: [item('a', 'feed', CATS)] })
      },
    })
    expect(await client.blueskySavedFeeds!()).toHaveLength(1)
    expect(await client.fetchTimeline({ type: 'feed', uri: CATS })).toHaveLength(1)
  })
})

describe('fetchTimeline feed', () => {
  it('reads getFeed with the cursor as it came, and maps the entries', async () => {
    const { agent, client } = setup()
    agent.app.bsky.feed.getFeed.mockResolvedValue({ data: { feed: [entry(1), { ...entry(2), reason: { $type: 'app.bsky.feed.defs#reasonPin' } }], cursor: 'next' } })
    const res = await client.fetchTimeline({ type: 'feed', uri: CATS }, { cursor: 'abc', limit: 20 })
    expect(agent.app.bsky.feed.getFeed).toHaveBeenCalledWith({ feed: CATS, cursor: 'abc', limit: 20 })
    expect(res.map((s) => s.id)).toEqual(['at://did:plc:bob/app.bsky.feed.post/p1', 'at://did:plc:bob/app.bsky.feed.post/p2'])
    expect(res.nextCursor).toBe('next')
    expect(res[0]!.bluesky!.viewerOf).toBe(READER)
    expect(res[0]!.bluesky!.moderation).toEqual(moderationFor('at://did:plc:bob/app.bsky.feed.post/p1'))
  })

  it('catches up from the top until the known entry', async () => {
    const { agent, client } = setup()
    agent.app.bsky.feed.getFeed.mockResolvedValue({ data: { feed: [entry(9), entry(8), entry(7)], cursor: 'c' } })
    const res = await client.fetchTimeline({ type: 'feed', uri: CATS }, { sinceId: 'at://did:plc:bob/app.bsky.feed.post/p8' })
    expect(agent.app.bsky.feed.getFeed).toHaveBeenCalledWith({ feed: CATS, limit: CATCH_UP_PAGE_SIZE })
    expect(res.map((s) => s.id.split('/').pop())).toEqual(['p9', 'p8'])
    expect(res.nextCursor).toBeNull()
  })

  it('says a gone feed is gone', async () => {
    const { agent, client } = setup()
    agent.app.bsky.feed.getFeed.mockRejectedValue(xrpcError(400, 'UnknownFeed', 'Unknown feed'))
    await expect(client.fetchTimeline({ type: 'feed', uri: CATS }))
      .rejects.toMatchObject({ code: 'not_found', message: 'This feed is gone. Its owner may have deleted it.' })
  })

  it('says a failing feed did not load, keeping the code', async () => {
    const { agent, client } = setup()
    agent.app.bsky.feed.getFeed.mockRejectedValue(xrpcError(502, 'UpstreamFailure', 'feed unavailable'))
    await expect(client.fetchTimeline({ type: 'feed', uri: CATS }))
      .rejects.toMatchObject({ code: 'server_error', message: 'This feed did not load. Try again later.' })
  })

  it('leaves a 401 as for reads', async () => {
    const { agent, client, onUnauthorized } = setup()
    agent.app.bsky.feed.getFeed.mockRejectedValue(xrpcError(401, 'AuthMissing', 'Authentication Required'))
    await expect(client.fetchTimeline({ type: 'feed', uri: CATS }))
      .rejects.toMatchObject({ code: 'unauthorized', message: 'Authentication Required' })
    expect(onUnauthorized).toHaveBeenCalled()
  })
})
