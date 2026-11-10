import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { CATCH_UP_PAGE_SIZE, createBlueskyClient, type BlueskyAgent } from '../client.js'
import { fixture, moderationFor, READER } from './_helpers.js'

// Search and the hashtag timeline (README, "Search (#192, #193)").

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))
vi.mock('../embeds.js', () => ({ mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, recordCard: null, quote: null })) }))

const basePost = () => fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json').feed[0]!.post

function post(n: number | string): AppBskyFeedDefs.PostView {
  return { ...basePost(), uri: `at://did:plc:bob/app.bsky.feed.post/p${n}`, cid: `bafy${n}`, $type: 'app.bsky.feed.defs#postView' }
}

function actor(name: string): AppBskyActorDefs.ProfileView {
  return { ...fixture<AppBskyActorDefs.ProfileView>('profile-detailed.json'), did: `did:plc:${name}`, handle: `${name}.example.com` }
}

function xrpcError(status: number, error: string, message = error, headers?: Record<string, string>) {
  return Object.assign(new Error(message), { status, error, headers })
}

function setup() {
  const searchActors = vi.fn()
  const searchPosts = vi.fn()
  const agent = {
    did: 'did:plc:reader',
    getTimeline: vi.fn(), getAuthorFeed: vi.fn(), getPostThread: vi.fn(), getPosts: vi.fn(),
    getProfile: vi.fn(), getProfiles: vi.fn(),
    app: { bsky: {
      bookmark: { getBookmarks: vi.fn() }, graph: { getMutes: vi.fn(), getBlocks: vi.fn() },
      actor: { searchActors }, feed: { searchPosts },
    } },
  }
  const onUnauthorized = vi.fn()
  const client = createBlueskyClient({
    userKey: READER,
    agent: agent as unknown as BlueskyAgent,
    moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    onUnauthorized,
  })
  return { client, searchActors, searchPosts, onUnauthorized }
}

describe('search', () => {
  it('asks people and posts at once, maps both, and keeps each cursor', async () => {
    const { client, searchActors, searchPosts } = setup()
    searchActors.mockResolvedValue({ data: { actors: [actor('alice'), actor('carol')], cursor: 'A2' } })
    searchPosts.mockResolvedValue({ data: { posts: [post(1)], cursor: 'P2' } })
    const r = await client.search({ q: '  cats ', limit: 20 })
    expect(searchActors).toHaveBeenCalledWith({ q: 'cats', limit: 20 })
    expect(searchPosts).toHaveBeenCalledWith({ q: 'cats', limit: 20 })
    expect(r.accounts.map((a) => a.acct)).toEqual(['alice.example.com', 'carol.example.com'])
    // Each actor carries its own profile decision.
    expect(r.accounts[0]!.bluesky?.moderation).toEqual(moderationFor('did:plc:alice'))
    expect(r.statuses.map((s) => s.id)).toEqual(['at://did:plc:bob/app.bsky.feed.post/p1'])
    expect(r.statuses[0]!.bluesky?.viewerOf).toBe(READER)
    expect(r.hashtags).toEqual([])
    expect(r.bluesky).toEqual({ accountsCursor: 'A2', statusesCursor: 'P2' })
  })

  it('reads the next page of one kind only', async () => {
    const { client, searchActors, searchPosts } = setup()
    searchPosts.mockResolvedValue({ data: { posts: [post(3)], cursor: 'P3' } })
    const r = await client.search({ q: 'cats', type: 'statuses', cursor: 'P2', limit: 20 })
    expect(searchActors).not.toHaveBeenCalled()
    expect(searchPosts).toHaveBeenCalledWith({ q: 'cats', cursor: 'P2', limit: 20 })
    expect(r.accounts).toEqual([])
    expect(r.bluesky).toEqual({ accountsCursor: null, statusesCursor: 'P3' })

    searchActors.mockResolvedValue({ data: { actors: [actor('dan')] } })
    const people = await client.search({ q: 'cats', type: 'accounts', cursor: 'A2' })
    expect(searchActors).toHaveBeenCalledWith({ q: 'cats', cursor: 'A2' })
    // No cursor in the answer: that kind ends.
    expect(people.bluesky).toEqual({ accountsCursor: null, statusesCursor: null })
  })

  it('ends a kind on an empty page, even with a cursor', async () => {
    const { client, searchActors, searchPosts } = setup()
    searchActors.mockResolvedValue({ data: { actors: [], cursor: 'A2' } })
    searchPosts.mockResolvedValue({ data: { posts: [], cursor: 'P2' } })
    const r = await client.search({ q: 'cats' })
    expect(r.bluesky).toEqual({ accountsCursor: null, statusesCursor: null })
  })

  it('makes no call for an empty query or for hashtags', async () => {
    const { client, searchActors, searchPosts } = setup()
    for (const params of [{ q: '   ' }, { q: 'cats', type: 'hashtags' as const }]) {
      const r = await client.search(params)
      expect(r).toEqual({ accounts: [], statuses: [], hashtags: [], bluesky: { accountsCursor: null, statusesCursor: null } })
    }
    expect(searchActors).not.toHaveBeenCalled()
    expect(searchPosts).not.toHaveBeenCalled()
  })

  it('drops one bad post, not the page', async () => {
    const { client, searchActors, searchPosts } = setup()
    searchActors.mockResolvedValue({ data: { actors: [] } })
    searchPosts.mockResolvedValue({ data: { posts: [{ uri: 'at://x/app.bsky.feed.post/bad' }, post(2)], cursor: 'P2' } })
    const r = await client.search({ q: 'cats' })
    expect(r.statuses.map((s) => s.id)).toEqual(['at://did:plc:bob/app.bsky.feed.post/p2'])
    expect(r.bluesky?.statusesCursor).toBe('P2')
  })

  it('fails when either call fails, with a message a screen can show for a 429', async () => {
    const { client, searchActors, searchPosts } = setup()
    searchActors.mockResolvedValue({ data: { actors: [] } })
    searchPosts.mockRejectedValue(xrpcError(429, 'RateLimitExceeded', 'Rate Limit Exceeded'))
    await expect(client.search({ q: 'cats' })).rejects.toMatchObject({
      code: 'rate_limited', message: 'Bluesky is getting too many requests. Wait a minute, then try again.',
    })
    searchPosts.mockRejectedValue(Object.assign(new Error('fetch failed'), { status: 1 }))
    await expect(client.search({ q: 'dogs' })).rejects.toMatchObject({ code: 'unreachable', message: 'Could not reach Bluesky.' })
  })

  it('calls onUnauthorized on a 401', async () => {
    const { client, searchActors, searchPosts, onUnauthorized } = setup()
    searchActors.mockRejectedValue(xrpcError(401, 'AuthRequired'))
    searchPosts.mockResolvedValue({ data: { posts: [] } })
    await expect(client.search({ q: 'cats' })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalled()
  })
})

describe('hashtag timeline', () => {
  it('searches the newest posts with the tag, cursor passed back as it came', async () => {
    const { client, searchPosts } = setup()
    searchPosts.mockResolvedValue({ data: { posts: [post(1), post(2)], cursor: 'C2' } })
    const page = await client.fetchTimeline({ type: 'hashtag', tag: 'Cats' }, { cursor: 'C1', limit: 25 })
    expect(searchPosts).toHaveBeenCalledWith({ q: '#Cats', sort: 'latest', cursor: 'C1', limit: 25 })
    expect(page.map((s) => s.id)).toEqual(['at://did:plc:bob/app.bsky.feed.post/p1', 'at://did:plc:bob/app.bsky.feed.post/p2'])
    expect(page.nextCursor).toBe('C2')
  })

  it('ends on an empty page', async () => {
    const { client, searchPosts } = setup()
    searchPosts.mockResolvedValue({ data: { posts: [], cursor: 'C2' } })
    const page = await client.fetchTimeline({ type: 'hashtag', tag: 'cats' })
    expect(page.nextCursor).toBeNull()
  })

  it('catches up from the top until it meets the known top post', async () => {
    const { client, searchPosts } = setup()
    searchPosts.mockResolvedValue({ data: { posts: [post('new'), post('top'), post('old')], cursor: 'C2' } })
    const page = await client.fetchTimeline({ type: 'hashtag', tag: 'cats' }, { sinceId: 'at://did:plc:bob/app.bsky.feed.post/ptop' })
    expect(searchPosts).toHaveBeenCalledWith({ q: '#cats', sort: 'latest', limit: CATCH_UP_PAGE_SIZE })
    expect(page.map((s) => s.id)).toEqual(['at://did:plc:bob/app.bsky.feed.post/pnew', 'at://did:plc:bob/app.bsky.feed.post/ptop'])
    expect(page.nextCursor).toBeNull()
  })

  it('says a 429 plainly', async () => {
    const { client, searchPosts } = setup()
    searchPosts.mockRejectedValue(xrpcError(429, 'RateLimitExceeded'))
    await expect(client.fetchTimeline({ type: 'hashtag', tag: 'cats' })).rejects.toMatchObject({
      code: 'rate_limited', message: 'Bluesky is getting too many requests. Wait a minute, then try again.',
    })
  })
})
