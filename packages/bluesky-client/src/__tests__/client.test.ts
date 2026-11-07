import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api'
import { CaribouError } from '@beatzball/caribou-mastodon-client'
import { describe, expect, it, vi } from 'vitest'
import { BLUESKY_CAPABILITIES, CATCH_UP_MAX_PAGES, CATCH_UP_PAGE_SIZE, createBlueskyClient, type BlueskyAgent } from '../client.js'
import { fixture, moderationFor, READER } from './_helpers.js'

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))
vi.mock('../embeds.js', () => ({ mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, quote: null })) }))

const basePost = () => fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json').feed[0]!.post

function post(n: number | string): AppBskyFeedDefs.PostView {
  return { ...basePost(), uri: `at://did:plc:bob/app.bsky.feed.post/p${n}`, cid: `bafy${n}`, $type: 'app.bsky.feed.defs#postView' }
}
const entry = (n: number | string): AppBskyFeedDefs.FeedViewPost => ({ post: post(n) })

function xrpcError(status: number, error: string, message = error, headers?: Record<string, string>) {
  return Object.assign(new Error(message), { status, error, headers })
}

function setup(over: Partial<Record<string, unknown>> = {}) {
  const agent = {
    did: 'did:plc:reader',
    getTimeline: vi.fn(),
    getAuthorFeed: vi.fn(),
    getPostThread: vi.fn(),
    getPosts: vi.fn(),
    getProfile: vi.fn(),
    getProfiles: vi.fn(),
    app: { bsky: { bookmark: { getBookmarks: vi.fn() }, graph: { getMutes: vi.fn(), getBlocks: vi.fn() } } },
    ...over,
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

/** A feed of `pages` pages, newest first: page i holds entries i*size … i*size+size-1. */
function pagedFeed(pages: number, size = CATCH_UP_PAGE_SIZE) {
  return vi.fn(async ({ cursor }: { cursor?: string }) => {
    const i = cursor ? Number(cursor) : 0
    const feed = i < pages ? Array.from({ length: size }, (_, k) => entry(i * size + k)) : []
    return { data: { feed, ...(i + 1 < pages ? { cursor: String(i + 1) } : {}) } }
  })
}

describe('capabilities and order', () => {
  it('describes Bluesky and keeps feed order', () => {
    const { client } = setup()
    expect(client.capabilities).toBe(BLUESKY_CAPABILITIES)
    expect(client.capabilities).toMatchObject({ network: 'bluesky', maxChars: 300, maxBytes: 3000, maxImages: 4, maxImageBytes: 2_000_000, readLagMs: 60_000, localTimeline: false, publicTimeline: false })
    expect(client.timelineOrder('home')).toBeNull()
    expect(client.timelineOrder('bookmarks')).toBeNull()
  })
})

describe('fetchTimeline home', () => {
  it('maps the page and passes the cursor back as it came', async () => {
    const page = fixture<{ cursor: string; feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json')
    const { agent, client } = setup()
    agent.getTimeline.mockResolvedValue({ data: page })
    const res = await client.fetchTimeline('home', { cursor: 'abc', limit: 20 })
    expect(agent.getTimeline).toHaveBeenCalledWith({ cursor: 'abc', limit: 20 })
    expect(res.map((s) => s.id)).toEqual([
      'at://did:plc:bob/app.bsky.feed.post/3lbobpost1',
      'at://did:plc:bob/app.bsky.feed.repost/3lbobrepost',
      expect.stringMatching(/^repost:/),
    ])
    expect(res.nextCursor).toBe(page.cursor)
    expect(res[0]!.bluesky!.viewerOf).toBe(READER)
  })

  it('ends the feed on an empty page, even with a cursor', async () => {
    const { agent, client } = setup()
    agent.getTimeline.mockResolvedValue({ data: { feed: [], cursor: 'more' } })
    expect((await client.fetchTimeline('home')).nextCursor).toBeNull()
  })

  it('ends the feed when the AppView sends no cursor', async () => {
    const { agent, client } = setup()
    agent.getTimeline.mockResolvedValue({ data: { feed: [entry(1)] } })
    expect((await client.fetchTimeline('home')).nextCursor).toBeNull()
  })

  it('shares one request between two equal reads in flight', async () => {
    const { agent, client } = setup()
    agent.getTimeline.mockResolvedValue({ data: { feed: [entry(1)] } })
    await Promise.all([client.fetchTimeline('home'), client.fetchTimeline('home')])
    expect(agent.getTimeline).toHaveBeenCalledTimes(1)
  })
})

describe('catch-up without since_id (seam 7)', () => {
  it('answers the entries above the known top, then the top, when it is on the first page', async () => {
    const { agent, client } = setup({ getTimeline: pagedFeed(3) })
    const res = await client.fetchTimeline('home', { sinceId: post(3).uri })
    expect(res.map((s) => s.id)).toEqual([0, 1, 2, 3].map((n) => post(n).uri))
    expect(res.nextCursor).toBeNull()
    expect(agent.getTimeline).toHaveBeenCalledTimes(1)
    expect(agent.getTimeline).toHaveBeenCalledWith({ limit: CATCH_UP_PAGE_SIZE })
  })

  it('answers just the top when nothing is new', async () => {
    const { client } = setup({ getTimeline: pagedFeed(3) })
    const res = await client.fetchTimeline('home', { sinceId: post(0).uri })
    expect(res.map((s) => s.id)).toEqual([post(0).uri])
  })

  it('pages on until it meets the top', async () => {
    const { agent, client } = setup({ getTimeline: pagedFeed(3) })
    const top = CATCH_UP_PAGE_SIZE + 5
    const res = await client.fetchTimeline('home', { sinceId: post(top).uri })
    expect(res).toHaveLength(top + 1)
    expect(res.at(-1)!.id).toBe(post(top).uri)
    expect(res.nextCursor).toBeNull()
    expect(agent.getTimeline).toHaveBeenNthCalledWith(2, { cursor: '1', limit: CATCH_UP_PAGE_SIZE })
  })

  it('meets a repost by its entry id, not by its post', async () => {
    const page = fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json')
    const { client } = setup({ getTimeline: vi.fn(async () => ({ data: { feed: page.feed, cursor: 'x' } })) })
    const res = await client.fetchTimeline('home', { sinceId: 'at://did:plc:bob/app.bsky.feed.repost/3lbobrepost' })
    expect(res).toHaveLength(2)
    expect(res.nextCursor).toBeNull()
  })

  it('is a gap after 3 pages without the top: every entry read, and the cursor after them', async () => {
    const { agent, client } = setup({ getTimeline: pagedFeed(5) })
    const res = await client.fetchTimeline('home', { sinceId: 'at://did:plc:bob/app.bsky.feed.post/gone' })
    expect(agent.getTimeline).toHaveBeenCalledTimes(CATCH_UP_MAX_PAGES)
    expect(res).toHaveLength(CATCH_UP_MAX_PAGES * CATCH_UP_PAGE_SIZE)
    expect(res.some((s) => s.id.endsWith('/gone'))).toBe(false)
    expect(res.nextCursor).toBe(String(CATCH_UP_MAX_PAGES))
  })

  it('is a gap with no cursor when the feed ends before the top', async () => {
    const { agent, client } = setup({ getTimeline: pagedFeed(1, 4) })
    const res = await client.fetchTimeline('home', { sinceId: 'at://did:plc:bob/app.bsky.feed.post/gone' })
    expect(agent.getTimeline).toHaveBeenCalledTimes(1)
    expect(res).toHaveLength(4)
    expect(res.nextCursor).toBeNull()
  })

  it('answers an empty page for an empty feed', async () => {
    const { client } = setup({ getTimeline: pagedFeed(0) })
    const res = await client.fetchTimeline('home', { sinceId: 'x' })
    expect(res).toHaveLength(0)
    expect(res.nextCursor).toBeNull()
  })
})

describe('fetchTimeline, other kinds', () => {
  it('maps bookmarks and leaves out deleted ones, keeping the cursor', async () => {
    const { agent, client } = setup()
    agent.app.bsky.bookmark.getBookmarks.mockResolvedValue({ data: { cursor: 'b2', bookmarks: [
      { subject: { uri: post(1).uri, cid: 'c' }, item: post(1) },
      { subject: { uri: 'at://x/app.bsky.feed.post/y', cid: 'c' }, item: { $type: 'app.bsky.feed.defs#notFoundPost', uri: 'at://x/app.bsky.feed.post/y', notFound: true } },
    ] } })
    const res = await client.fetchTimeline('bookmarks', { cursor: 'b1' })
    expect(agent.app.bsky.bookmark.getBookmarks).toHaveBeenCalledWith({ cursor: 'b1' })
    expect(res.map((s) => s.id)).toEqual([post(1).uri])
    expect(res.nextCursor).toBe('b2')
  })

  it('answers a bookmarks check with an empty page, as on Mastodon', async () => {
    const { agent, client } = setup()
    const res = await client.fetchTimeline('bookmarks', { sinceId: 'x' })
    expect(res).toHaveLength(0)
    expect(res.nextCursor).toBeNull()
    expect(agent.app.bsky.bookmark.getBookmarks).not.toHaveBeenCalled()
  })

  it('ends bookmarks on an empty page', async () => {
    const { agent, client } = setup()
    agent.app.bsky.bookmark.getBookmarks.mockResolvedValue({ data: { cursor: 'b2', bookmarks: [] } })
    expect((await client.fetchTimeline('bookmarks', { limit: 5 })).nextCursor).toBeNull()
  })

  it.each(['local', 'public'] as const)('has no %s timeline', async (kind) => {
    const { client } = setup()
    await expect(client.fetchTimeline(kind)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('names the issue for hashtag and list timelines', async () => {
    const { client } = setup()
    await expect(client.fetchTimeline({ type: 'hashtag', tag: 'x' })).rejects.toThrow('#193')
    await expect(client.fetchTimeline({ type: 'list', id: 'x' })).rejects.toThrow('#195')
  })
})

describe('posts and threads', () => {
  it('fetchStatus maps the post, or says not found', async () => {
    const { agent, client } = setup()
    agent.getPosts.mockResolvedValueOnce({ data: { posts: [post(1)] } })
    expect((await client.fetchStatus(post(1).uri)).id).toBe(post(1).uri)
    expect(agent.getPosts).toHaveBeenCalledWith({ uris: [post(1).uri] })
    agent.getPosts.mockResolvedValueOnce({ data: { posts: [] } })
    await expect(client.fetchStatus(post(2).uri)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('fetchStatuses asks 25 at a time', async () => {
    const { agent, client } = setup()
    agent.getPosts.mockImplementation(async ({ uris }: { uris: string[] }) => ({ data: { posts: uris.map((u) => ({ ...post(0), uri: u })) } }))
    const ids = Array.from({ length: 30 }, (_, i) => post(i).uri)
    const res = await client.fetchStatuses(ids)
    expect(agent.getPosts).toHaveBeenCalledTimes(2)
    expect(agent.getPosts.mock.calls[0]![0].uris).toHaveLength(25)
    expect(res.map((s) => s.id)).toEqual(ids)
    expect(await client.fetchStatuses([])).toEqual([])
  })

  it('fetchThread: ancestors oldest first, descendants depth first, stubs left out', async () => {
    const tvp = (n: string, extra: object = {}) => ({ $type: 'app.bsky.feed.defs#threadViewPost', post: post(n), ...extra })
    const thread = tvp('focus', {
      parent: tvp('parent', { parent: tvp('root', { parent: { $type: 'app.bsky.feed.defs#notFoundPost', uri: 'u', notFound: true } }) }),
      replies: [
        tvp('r1', { replies: [tvp('r1a')] }),
        { $type: 'app.bsky.feed.defs#blockedPost', uri: 'b', blocked: true, author: { did: 'd' } },
        tvp('r2'),
      ],
    })
    const { agent, client } = setup()
    agent.getPostThread.mockResolvedValue({ data: { thread } })
    const res = await client.fetchThread(post('focus').uri)
    expect(agent.getPostThread).toHaveBeenCalledWith({ uri: post('focus').uri })
    expect(res.ancestors.map((s) => s.id)).toEqual([post('root').uri, post('parent').uri])
    expect(res.descendants.map((s) => s.id)).toEqual([post('r1').uri, post('r1a').uri, post('r2').uri])
  })

  it('fetchThread says not found for a missing or blocked focus', async () => {
    const { agent, client } = setup()
    agent.getPostThread.mockResolvedValue({ data: { thread: { $type: 'app.bsky.feed.defs#notFoundPost', uri: 'u', notFound: true } } })
    await expect(client.fetchThread('u')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('accounts', () => {
  const profile = () => fixture<AppBskyActorDefs.ProfileViewDetailed>('profile-detailed.json')

  it('lookupAccount strips @ and sets the profile moderation', async () => {
    const { agent, client } = setup()
    agent.getProfile.mockResolvedValue({ data: profile() })
    const a = await client.lookupAccount('@alice.example.com')
    expect(agent.getProfile).toHaveBeenCalledWith({ actor: 'alice.example.com' })
    expect(a.bluesky!.moderation).toEqual(moderationFor('did:plc:alice'))
  })

  it('verifyCredentials reads the reader profile, with an empty source', async () => {
    const { agent, client } = setup()
    agent.getProfile.mockResolvedValue({ data: { ...profile(), did: 'did:plc:reader' } })
    const me = await client.verifyCredentials()
    expect(agent.getProfile).toHaveBeenCalledWith({ actor: 'did:plc:reader' })
    expect(me.source).toMatchObject({ note: 'Hi <there>\nI post at https://example.com', privacy: 'public', fields: [] })
    expect(me.role.name).toBe('')
  })

  it('verifyCredentials is unauthorized with no session', async () => {
    const { client, onUnauthorized } = setup({ did: undefined })
    await expect(client.verifyCredentials()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalled()
  })

  it.each([['posts', 'posts_no_replies'], ['replies', 'posts_with_replies'], ['media', 'posts_with_media']] as const)(
    'fetchAccountStatuses %s asks for %s with no pins', async (tab, filter) => {
      const { agent, client } = setup()
      agent.getAuthorFeed.mockResolvedValue({ data: { feed: [entry(1)], cursor: 'c2' } })
      const res = await client.fetchAccountStatuses('did:plc:bob', { tab, cursor: 'c1', limit: 10 })
      expect(agent.getAuthorFeed).toHaveBeenCalledWith({ actor: 'did:plc:bob', filter, includePins: false, cursor: 'c1', limit: 10 })
      expect(res.nextCursor).toBe('c2')
    })

  it('fetchRelationships asks 25 at a time and answers in the order asked', async () => {
    const { agent, client } = setup()
    agent.getProfiles.mockImplementation(async ({ actors }: { actors: string[] }) => ({
      data: { profiles: [...actors].reverse().filter((d) => d !== 'did:plc:u3').map((did) => ({ did, handle: `${did.slice(8)}.example.com` })) },
    }))
    const ids = Array.from({ length: 27 }, (_, i) => `did:plc:u${i}`)
    const res = await client.fetchRelationships(ids)
    expect(agent.getProfiles).toHaveBeenCalledTimes(2)
    expect(res.map((r) => r.id)).toEqual(ids.filter((d) => d !== 'did:plc:u3'))
    expect(await client.fetchRelationships([])).toEqual([])
  })

  it.each(['mutes', 'blocks'] as const)('fetches %s as a page of accounts', async (kind) => {
    const { agent, client } = setup()
    const fn = kind === 'mutes' ? agent.app.bsky.graph.getMutes : agent.app.bsky.graph.getBlocks
    fn.mockResolvedValue({ data: { [kind]: [profile()], cursor: 'n' } })
    const res = kind === 'mutes' ? await client.fetchMutes({ cursor: 'c', limit: 5 }) : await client.fetchBlocks()
    expect(fn).toHaveBeenCalledWith(kind === 'mutes' ? { cursor: 'c', limit: 5 } : {})
    expect(res.map((a) => a.id)).toEqual(['did:plc:alice'])
    expect(res[0]!.bluesky!.moderation).toEqual(moderationFor('did:plc:alice'))
    expect(res.nextCursor).toBe('n')
  })

  it('has no server filters', async () => {
    expect(await setup().client.fetchFilters()).toEqual([])
  })
})

describe('errors and later features', () => {
  it('turns a 401 into unauthorized and tells the session', async () => {
    const { agent, client, onUnauthorized } = setup()
    agent.getTimeline.mockRejectedValue(xrpcError(401, 'AuthenticationRequired'))
    await expect(client.fetchTimeline('home')).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('turns the AppView 400 for a missing profile into not_found', async () => {
    const { agent, client, onUnauthorized } = setup()
    agent.getProfile.mockRejectedValue(xrpcError(400, 'InvalidRequest', 'Profile not found'))
    await expect(client.lookupAccount('nobody.example.com')).rejects.toMatchObject({ code: 'not_found' })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it.each(['favourite', 'reblog', 'bookmark', 'follow', 'block', 'createStatus', 'search', 'fetchNotifications', 'fetchLists', 'fetchTag', 'votePoll', 'editStatus'] as const)(
    '%s is not here yet', async (method) => {
      const { client } = setup()
      const call = (client[method] as () => Promise<unknown>)()
      await expect(call).rejects.toBeInstanceOf(CaribouError)
      await expect(call).rejects.toMatchObject({ code: 'not_found', message: expect.stringMatching(/^Bluesky: /) })
    })
})
