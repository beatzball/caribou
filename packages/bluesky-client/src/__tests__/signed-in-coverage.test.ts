import { BSKY_LABELER_DID, type AppBskyFeedDefs, type ModerationPrefs } from '@atproto/api'
import type { BlueskyModerationResult, Status } from '@beatzball/caribou-mastodon-client'
import { describe, expect, it, vi } from 'vitest'
import { createBlueskyClient, type BlueskyAgent } from '../client.js'
import { ACCEPTED_LABELERS_LIMIT, acceptedLabelers, answerCoverage } from '../content-labelers.js'
import { blueskyCheckSettled, readerModerationSource, type LabelDefs } from '../moderation.js'
import { fixture, READER } from './_helpers.js'

// Labeler coverage on every signed-in read (README, "Labeler coverage").
// A browser cannot read `atproto-content-labelers` (the AppView and the PDS
// do not expose it), so most of these answers come without the header, as
// in a real browser: coverage is then what the request sent in
// `atproto-accept-labelers`. Through the real `readerModerationSource` and
// the real reader veil check.

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))
vi.mock('../embeds.js', () => ({ mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, recordCard: null, quote: null })) }))

const OTHER = 'did:web:labeler.example.com'
const PREFS: ModerationPrefs = { adultContentEnabled: false, labels: {}, labelers: [{ did: OTHER, labels: {} }], mutedWords: [], hiddenPosts: [] }
const DEFS: LabelDefs = { [BSKY_LABELER_DID]: [], [OTHER]: [] }
const reader = { userKey: READER, prefs: PREFS, labelDefs: DEFS }

const basePost = () => fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json').feed[0]!.post
function post(n: number | string): AppBskyFeedDefs.PostView {
  return { ...basePost(), uri: `at://did:plc:bob/app.bsky.feed.post/p${n}`, cid: `bafy${n}`, $type: 'app.bsky.feed.defs#postView' }
}
const profileView = () => ({ ...basePost().author, $type: 'app.bsky.actor.defs#profileViewDetailed' })

type Headers = Record<string, string>
/** The real case: the AppView sent the header, the browser cannot read it. */
const HIDDEN: Headers = {}
const header = (v: string): Headers => ({ 'atproto-content-labelers': v })

function setup(o: { labelers?: string[]; headers?: Headers; fail?: boolean } = {}) {
  const headers = o.headers ?? HIDDEN
  const answer = <T>(data: T) => async () => {
    if (o.fail) throw Object.assign(new Error('Internal'), { status: 500, error: 'InternalServerError' })
    return { data, headers }
  }
  const agent = {
    did: 'did:plc:reader',
    appLabelers: [BSKY_LABELER_DID],
    // As `restoreClient` configures it: Bluesky's labeler and the reader's.
    labelers: o.labelers ?? [BSKY_LABELER_DID, OTHER],
    getTimeline: vi.fn(answer({ feed: [{ post: post(1) }], cursor: 'c' })),
    getAuthorFeed: vi.fn(answer({ feed: [{ post: post(2) }], cursor: 'c' })),
    // Two ancestors, and a reply with a reply of its own.
    getPostThread: vi.fn(answer({ thread: {
      $type: 'app.bsky.feed.defs#threadViewPost', post: post(3),
      parent: { $type: 'app.bsky.feed.defs#threadViewPost', post: post(2), parent: { $type: 'app.bsky.feed.defs#threadViewPost', post: post(1) } },
      replies: [{ $type: 'app.bsky.feed.defs#threadViewPost', post: post(4), replies: [{ $type: 'app.bsky.feed.defs#threadViewPost', post: post(6) }] }],
    } })),
    getPosts: vi.fn(async ({ uris }: { uris: string[] }) => answer({ posts: uris.map((u) => ({ ...post(0), uri: u })) })()),
    getProfile: vi.fn(answer(profileView())),
    listNotifications: vi.fn(answer(fixture<unknown>('notifications-page.json'))),
    app: {
      bsky: {
        bookmark: { getBookmarks: vi.fn(answer({ bookmarks: [{ item: post(5) as object }], cursor: 'c' })) },
        graph: { getMutes: vi.fn(answer({ mutes: [profileView()] })), getBlocks: vi.fn(answer({ blocks: [profileView()] })) },
      },
    },
  }
  const client = createBlueskyClient({
    userKey: READER,
    agent: agent as unknown as BlueskyAgent,
    moderation: readerModerationSource('did:plc:reader', () => ({ prefs: PREFS, labelDefs: DEFS })),
  })
  return { client, agent }
}

const settled = (moderation: BlueskyModerationResult) => blueskyCheckSettled({ viewerOf: READER, moderation }, reader)
const postOf = (s: Status) => s.bluesky!.moderation
const authorOf = (a: { bluesky?: { moderation?: BlueskyModerationResult } }) => a.bluesky!.moderation!

// Each signed-in read, with what it moderates.
const READS: [string, (c: ReturnType<typeof setup>['client']) => Promise<BlueskyModerationResult[]>][] = [
  ['Following (getTimeline)', async (c) => (await c.fetchTimeline('home')).map(postOf)],
  ['Following catch-up', async (c) => (await c.fetchTimeline('home', { sinceId: 'gone' })).map(postOf)],
  ['author feed (getAuthorFeed)', async (c) => (await c.fetchAccountStatuses('did:plc:bob', { tab: 'posts' })).map(postOf)],
  ['thread (getPostThread)', async (c) => {
    const t = await c.fetchThread('at://x')
    // Both ancestors, the reply and the reply to it.
    expect(t.ancestors).toHaveLength(2)
    expect(t.descendants).toHaveLength(2)
    return [...t.ancestors, ...t.descendants].map(postOf)
  }],
  ['fetchStatus (getPosts)', async (c) => [postOf(await c.fetchStatus('at://did:plc:bob/app.bsky.feed.post/p9'))]],
  ['fetchStatuses (getPosts)', async (c) => (await c.fetchStatuses(['at://a/app.bsky.feed.post/1'])).map(postOf)],
  ['bookmarks (getBookmarks)', async (c) => (await c.fetchTimeline('bookmarks')).map(postOf)],
  ['profile (lookupAccount)', async (c) => [authorOf(await c.lookupAccount('@bob.example.com'))]],
  ['verifyCredentials (getProfile)', async (c) => [authorOf(await c.verifyCredentials())]],
  ['mutes (getMutes)', async (c) => (await c.fetchMutes()).map(authorOf)],
  ['blocks (getBlocks)', async (c) => (await c.fetchBlocks()).map(authorOf)],
  ['notification authors', async (c) => (await c.fetchNotifications()).map((n) => authorOf(n.account))],
  ['notification posts', async (c) => (await c.fetchNotifications()).flatMap((n) => n.status ? [postOf(n.status)] : [])],
]

describe('answerCoverage', () => {
  it('the header, when it can be read, is the coverage', () => {
    expect(answerCoverage(header(`${BSKY_LABELER_DID};redact`), [BSKY_LABELER_DID, OTHER], [BSKY_LABELER_DID, OTHER])).toEqual([BSKY_LABELER_DID])
    expect(answerCoverage({ 'Atproto-Content-Labelers': '' }, [BSKY_LABELER_DID], [BSKY_LABELER_DID])).toEqual([])
  })

  it('no header: what the request sent, both when it started and when it landed', () => {
    expect(answerCoverage(HIDDEN, [BSKY_LABELER_DID, OTHER], [BSKY_LABELER_DID, OTHER])).toEqual([BSKY_LABELER_DID, OTHER])
    expect(answerCoverage(undefined, [BSKY_LABELER_DID, OTHER], [BSKY_LABELER_DID])).toEqual([BSKY_LABELER_DID])
  })

  it('never counts a labeler past the limit, in the order sent', () => {
    const many = Array.from({ length: ACCEPTED_LABELERS_LIMIT + 2 }, (_, i) => `did:web:l${i}.example.com`)
    const sent = [BSKY_LABELER_DID, BSKY_LABELER_DID, ...many, 'not a did']
    const counted = acceptedLabelers(sent)
    expect(ACCEPTED_LABELERS_LIMIT).toBe(20)
    expect(counted).toHaveLength(20)
    expect(counted[0]).toBe(BSKY_LABELER_DID)
    expect(counted).not.toContain(many[19])
    expect(answerCoverage(HIDDEN, sent, sent)).toEqual(counted)
  })
})

describe.each([
  ['the header is not exposed (a real browser)', HIDDEN],
  ['the header is exposed', header(`${BSKY_LABELER_DID};redact, ${OTHER}`)],
])('every signed-in read settles a clean post, profile and author when %s', (_name, headers) => {
  it.each(READS)('%s', async (_read, run) => {
    const { client } = setup({ headers })
    const decisions = await run(client)
    expect(decisions.length).toBeGreaterThan(0)
    for (const m of decisions) {
      expect(m.labelersCovered).toEqual(expect.arrayContaining([BSKY_LABELER_DID, OTHER]))
      expect(m.contexts.contentList).toMatchObject({ filter: false, blur: false })
      expect(settled(m)).toBe(true)
    }
  })
})

describe('what keeps the cover', () => {
  it.each(READS)('%s: a labeler past the limit stays covered', async (_read, run) => {
    const filler = Array.from({ length: ACCEPTED_LABELERS_LIMIT }, (_, i) => `did:web:f${i}.example.com`)
    // The reader's labeler is sent 22nd.
    const { client } = setup({ labelers: [BSKY_LABELER_DID, ...filler, OTHER] })
    for (const m of await run(client)) {
      expect(m.labelersCovered).not.toContain(OTHER)
      expect(settled(m)).toBe(false)
    }
  })

  it.each(READS)('%s: a failed request settles nothing', async (_read, run) => {
    const { client } = setup({ fail: true })
    await expect(run(client)).rejects.toMatchObject({ code: 'server_error' })
  })

  it('an exposed header that leaves out a subscribed labeler stays covered', async () => {
    const { client } = setup({ headers: header(BSKY_LABELER_DID) })
    const [s] = await client.fetchTimeline('home')
    expect(postOf(s!).labelersCovered).toEqual([BSKY_LABELER_DID])
    expect(settled(postOf(s!))).toBe(false)
  })

  it('an agent that sent no labelers covers none', async () => {
    const { client, agent } = setup()
    ;(agent as { labelers?: unknown }).labelers = undefined
    ;(agent as { appLabelers?: unknown }).appLabelers = undefined
    const [s] = await client.fetchTimeline('home')
    expect(postOf(s!).labelersCovered).toEqual([])
    expect(settled(postOf(s!))).toBe(false)
  })

  it('a labeler configured while the read was in flight does not count', async () => {
    const { client, agent } = setup({ labelers: [BSKY_LABELER_DID] })
    agent.getTimeline.mockImplementationOnce(async () => {
      agent.labelers = [BSKY_LABELER_DID, OTHER]
      return { data: { feed: [{ post: post(1) }], cursor: 'c' }, headers: HIDDEN }
    })
    const [s] = await client.fetchTimeline('home')
    expect(postOf(s!).labelersCovered).toEqual([BSKY_LABELER_DID])
  })

  it('a labeler removed while the read was in flight does not count', async () => {
    const { client, agent } = setup()
    agent.getTimeline.mockImplementationOnce(async () => {
      agent.labelers = [BSKY_LABELER_DID]
      return { data: { feed: [{ post: post(1) }], cursor: 'c' }, headers: HIDDEN }
    })
    const [s] = await client.fetchTimeline('home')
    expect(postOf(s!).labelersCovered).toEqual([BSKY_LABELER_DID])
  })
})

describe('what the request sent', () => {
  it('an agent with no session counts as sending none (rule 2 is for the signed-in agent only)', async () => {
    const { client, agent } = setup()
    ;(agent as { did?: string }).did = undefined
    const [s] = await client.fetchTimeline('home')
    expect(postOf(s!).labelersCovered).toEqual([])
    expect(settled(postOf(s!))).toBe(false)
  })

  it("counts Agent.appLabelers: Bluesky's labeler is sent from there", async () => {
    // Only the reader's labeler is configured; Bluesky's comes from appLabelers.
    const { client } = setup({ labelers: [OTHER] })
    const [s] = await client.fetchTimeline('home')
    expect(postOf(s!).labelersCovered).toEqual([BSKY_LABELER_DID, OTHER])
    expect(settled(postOf(s!))).toBe(true)
  })
})

describe('a result from several answers keeps what every answer covered', () => {
  it('a Following catch-up that meets its anchor on a later page', async () => {
    const { client, agent } = setup()
    agent.getTimeline
      .mockImplementationOnce(async () => ({ data: { feed: [{ post: post(1) }], cursor: 'c1' }, headers: header(BSKY_LABELER_DID) }))
      .mockImplementationOnce(async () => ({ data: { feed: [{ post: post(2) }, { post: post(3) }], cursor: 'c2' }, headers: header(`${BSKY_LABELER_DID}, ${OTHER}`) }))
    const res = await client.fetchTimeline('home', { sinceId: post(3).uri })
    expect(agent.getTimeline).toHaveBeenCalledTimes(2)
    expect(res.nextCursor).toBeNull()
    expect(res).toHaveLength(3)
    for (const s of res) expect(postOf(s).labelersCovered).toEqual([BSKY_LABELER_DID])
  })

  it('a notifications catch-up that meets its anchor on a later page', async () => {
    const { client, agent } = setup()
    const all = fixture<{ notifications: { uri: string }[] }>('notifications-page.json').notifications
    agent.listNotifications
      .mockImplementationOnce(async () => ({ data: { cursor: 'c', notifications: all.slice(0, 2) }, headers: header(BSKY_LABELER_DID) }))
      .mockImplementationOnce(async () => ({ data: { notifications: all }, headers: header(`${BSKY_LABELER_DID}, ${OTHER}`) }))
    const res = await client.fetchNotifications({ sinceId: all.at(-1)!.uri })
    expect(agent.listNotifications).toHaveBeenCalledTimes(2)
    expect(res.nextCursor).toBeNull()
    expect(res.length).toBeGreaterThan(0)
    for (const n of res) {
      expect(authorOf(n.account).labelersCovered).toEqual([BSKY_LABELER_DID])
      expect(settled(authorOf(n.account))).toBe(false)
    }
  })

  it('a Following catch-up over several pages', async () => {
    const { client, agent } = setup()
    agent.getTimeline
      .mockImplementationOnce(async () => ({ data: { feed: [{ post: post(1) }], cursor: 'c1' }, headers: header(`${BSKY_LABELER_DID}, ${OTHER}`) }))
      .mockImplementationOnce(async () => ({ data: { feed: [{ post: post(2) }], cursor: 'c2' }, headers: header(BSKY_LABELER_DID) }))
      .mockImplementationOnce(async () => ({ data: { feed: [], cursor: 'c3' }, headers: header(`${BSKY_LABELER_DID}, ${OTHER}`) }))
    const res = await client.fetchTimeline('home', { sinceId: 'gone' })
    expect(res).toHaveLength(2)
    for (const s of res) expect(postOf(s).labelersCovered).toEqual([BSKY_LABELER_DID])
  })

  it('fetchStatuses over several getPosts batches', async () => {
    const { client, agent } = setup()
    agent.getPosts
      .mockImplementationOnce(async ({ uris }) => ({ data: { posts: uris.map((u) => ({ ...post(0), uri: u })) }, headers: HIDDEN }))
      .mockImplementationOnce(async ({ uris }) => ({ data: { posts: uris.map((u) => ({ ...post(0), uri: u })) }, headers: header(OTHER) }))
    const uris = Array.from({ length: 30 }, (_, i) => `at://did:plc:bob/app.bsky.feed.post/q${i}`)
    const res = await client.fetchStatuses(uris)
    expect(agent.getPosts).toHaveBeenCalledTimes(2)
    expect(res).toHaveLength(30)
    for (const s of res) expect(postOf(s).labelersCovered).toEqual([OTHER])
  })

  it('a bookmarks read that skipped an empty page', async () => {
    const { client, agent } = setup()
    agent.app.bsky.bookmark.getBookmarks
      .mockImplementationOnce(async () => ({ data: { bookmarks: [{ item: { $type: 'app.bsky.feed.defs#notFoundPost' } }], cursor: 'c1' }, headers: header(BSKY_LABELER_DID) }))
      .mockImplementationOnce(async () => ({ data: { bookmarks: [{ item: post(5) }], cursor: 'c2' }, headers: header(`${BSKY_LABELER_DID}, ${OTHER}`) }))
    const res = await client.fetchTimeline('bookmarks')
    expect(res).toHaveLength(1)
    expect(postOf(res[0]!).labelersCovered).toEqual([BSKY_LABELER_DID])
  })
})

// From the #231 review: the list answer and the getPosts answer must be told apart.
describe('notifications: the list answer and the getPosts answer each carry their own', () => {
  const run = async (list: Headers, posts: Headers | Headers[]) => {
    const { client, agent } = setup()
    agent.listNotifications.mockImplementation(async () => ({ data: fixture('notifications-page.json'), headers: list }))
    const each = Array.isArray(posts) ? posts : [posts]
    let i = 0
    agent.getPosts.mockImplementation(async ({ uris }) => ({ data: { posts: uris.map((u) => ({ ...post(0), uri: u })) }, headers: each[Math.min(i++, each.length - 1)]! }))
    const res = await client.fetchNotifications()
    const withPost = res.filter((n) => n.status)
    expect(withPost.length).toBeGreaterThan(0)
    return { res, withPost, agent }
  }

  it('list covered, posts not: authors settle, posts stay covered', async () => {
    const { res, withPost } = await run(header(`${BSKY_LABELER_DID}, ${OTHER}`), header(BSKY_LABELER_DID))
    for (const n of res) expect(settled(authorOf(n.account))).toBe(true)
    for (const n of withPost) expect(settled(postOf(n.status!))).toBe(false)
  })

  it('posts covered, list not: posts settle, authors stay covered', async () => {
    const { res, withPost } = await run(header(BSKY_LABELER_DID), header(`${BSKY_LABELER_DID}, ${OTHER}`))
    for (const n of res) expect(settled(authorOf(n.account))).toBe(false)
    for (const n of withPost) expect(settled(postOf(n.status!))).toBe(true)
  })

  it('several getPosts batches keep only what every batch covered', async () => {
    // A page that names more than 25 posts needs two getPosts batches.
    const { client, agent } = setup()
    const notifications = Array.from({ length: 30 }, (_, i) => ({
      uri: `at://did:plc:bob/app.bsky.feed.post/n${i}`, cid: `bafyn${i}`, author: basePost().author,
      reason: 'reply', record: { $type: 'app.bsky.feed.post', text: 'hi', createdAt: '2026-11-01T00:00:00.000Z' },
      isRead: false, indexedAt: `2026-11-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }))
    agent.listNotifications.mockImplementation(async () => ({ data: { notifications }, headers: header(`${BSKY_LABELER_DID}, ${OTHER}`) }))
    let i = 0
    agent.getPosts.mockImplementation(async ({ uris }) => ({
      data: { posts: uris.map((u) => ({ ...post(0), uri: u })) },
      headers: i++ === 0 ? header(`${BSKY_LABELER_DID}, ${OTHER}`) : header(BSKY_LABELER_DID),
    }))
    const res = await client.fetchNotifications()
    expect(agent.getPosts).toHaveBeenCalledTimes(2)
    const withPost = res.filter((n) => n.status)
    expect(withPost).toHaveLength(30)
    for (const n of withPost) {
      expect(postOf(n.status!).labelersCovered).toEqual([BSKY_LABELER_DID])
      expect(settled(postOf(n.status!))).toBe(false)
    }
    for (const n of res) expect(settled(authorOf(n.account))).toBe(true)
  })

  it('without the header, both take what their own request sent', async () => {
    const { res, withPost } = await run(HIDDEN, [HIDDEN, HIDDEN])
    for (const n of res) expect(settled(authorOf(n.account))).toBe(true)
    for (const n of withPost) expect(settled(postOf(n.status!))).toBe(true)
  })
})
