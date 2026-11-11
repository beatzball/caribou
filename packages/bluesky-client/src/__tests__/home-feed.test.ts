import type { AppBskyFeedDefs } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { createBlueskyClient, HOME_PREFS_TTL_MS, type BlueskyAgent } from '../client.js'
import { HOME_FEED_DEFAULTS, homeFeedPrefs, isQuotePost, replyContextViews, showInHome, type HomeFeedPrefs } from '../home-feed.js'
import { moderationFor, READER } from './_helpers.js'

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))

// README, "Home: feed prefs and reply context (#275)". Each test names its rule.

const ME = 'did:plc:reader'
type Who = { did: string; followed?: boolean }
const alice: Who = { did: 'did:plc:alice', followed: true }
const bob: Who = { did: 'did:plc:bob', followed: false }
const carol: Who = { did: 'did:plc:carol', followed: true }
const me: Who = { did: ME }

function author(w: Who) {
  return {
    did: w.did, handle: `${w.did.slice(8)}.example.com`, labels: [],
    viewer: w.followed ? { following: `at://${ME}/app.bsky.graph.follow/${w.did.slice(8)}` } : {},
  }
}

const uri = (w: Who, rkey: string) => `at://${w.did}/app.bsky.feed.post/${rkey}`

function post(w: Who, rkey: string, o: { reply?: { root: string; parent: string }; likes?: number; embed?: unknown } = {}): AppBskyFeedDefs.PostView {
  const ref = (u: string) => ({ uri: u, cid: `cid-${u.split('/').pop()}` })
  return {
    $type: 'app.bsky.feed.defs#postView',
    uri: uri(w, rkey), cid: `cid-${rkey}`,
    author: author(w),
    record: {
      $type: 'app.bsky.feed.post', text: rkey, createdAt: '2026-11-10T10:00:00.000Z',
      ...(o.reply ? { reply: { root: ref(o.reply.root), parent: ref(o.reply.parent) } } : {}),
    },
    likeCount: o.likes ?? 0, replyCount: 0, repostCount: 0, quoteCount: 0,
    indexedAt: '2026-11-10T10:00:00.000Z', viewer: {}, labels: [],
    ...(o.embed ? { embed: o.embed } : {}),
  } as AppBskyFeedDefs.PostView
}

/** A reply entry: `who` answers `parent`, in the thread of `root`. */
function reply(who: Who, rkey: string, parent: AppBskyFeedDefs.PostView, root: AppBskyFeedDefs.PostView | unknown = parent, o: { likes?: number; grand?: Who } = {}): AppBskyFeedDefs.FeedViewPost {
  const rootUri = (root as { uri?: string }).uri ?? uri(bob, 'gone')
  return {
    post: post(who, rkey, { reply: { root: rootUri, parent: parent.uri }, likes: o.likes }),
    reply: {
      root: root as AppBskyFeedDefs.PostView, parent,
      ...(o.grand ? { grandparentAuthor: author(o.grand) } : {}),
    },
  } as AppBskyFeedDefs.FeedViewPost
}

const plain = (w: Who, rkey: string): AppBskyFeedDefs.FeedViewPost => ({ post: post(w, rkey) })

function repost(by: Who, of: AppBskyFeedDefs.PostView): AppBskyFeedDefs.FeedViewPost {
  return {
    post: of,
    reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: author(by), uri: `at://${by.did}/app.bsky.feed.repost/r-${of.uri.split('/').pop()}`, cid: 'cid-r', indexedAt: '2026-11-10T11:00:00.000Z' },
  } as AppBskyFeedDefs.FeedViewPost
}

const quoteEmbed = (quoted: AppBskyFeedDefs.PostView) => ({
  $type: 'app.bsky.embed.record#view',
  record: { $type: 'app.bsky.embed.record#viewRecord', uri: quoted.uri, cid: quoted.cid, author: quoted.author, value: quoted.record, indexedAt: quoted.indexedAt },
})

const prefs = (o: Partial<HomeFeedPrefs> = {}): HomeFeedPrefs => ({ ...HOME_FEED_DEFAULTS, ...o })
const show = (e: AppBskyFeedDefs.FeedViewPost, o: Partial<HomeFeedPrefs> = {}) => showInHome(e, prefs(o), ME)

const bobRoot = post(bob, 'b0')
const aliceRoot = post(alice, 'a0')
const myRoot = post(me, 'm0')

describe('rule 1: prefs', () => {
  it('uses the SDK defaults when there is no home pref', () => {
    expect(homeFeedPrefs({ feedViewPrefs: {} })).toEqual(HOME_FEED_DEFAULTS)
    expect(homeFeedPrefs(undefined)).toEqual(HOME_FEED_DEFAULTS)
    expect(HOME_FEED_DEFAULTS).toEqual({ hideReplies: false, hideReposts: false, hideQuotePosts: false })
  })

  it('reads feedViewPrefs.home, and a wrong type is the default', () => {
    expect(homeFeedPrefs({ feedViewPrefs: { home: { hideReplies: true, hideReposts: true, hideQuotePosts: true } } }))
      .toEqual({ hideReplies: true, hideReposts: true, hideQuotePosts: true })
    expect(homeFeedPrefs({ feedViewPrefs: { home: { hideReplies: 'yes' } } })).toEqual(HOME_FEED_DEFAULTS)
  })

  it('ignores the legacy hideRepliesByUnfollowed and hideRepliesByLikeCount, as bsky.app does', () => {
    const p = homeFeedPrefs({ feedViewPrefs: { home: { hideRepliesByUnfollowed: false, hideRepliesByLikeCount: 5 } } })
    expect(p).toEqual(HOME_FEED_DEFAULTS)
    const parent = post(carol, 'c0')
    // A reply to an unfollowed author still hides; a reply with no likes still shows.
    expect(showInHome(reply(alice, 'a1', bobRoot), p, ME)).toBe(false)
    expect(showInHome(reply(alice, 'a2', parent, parent, { likes: 0 }), p, ME)).toBe(true)
  })

  it('reads only the home pref, not another feed', () => {
    expect(homeFeedPrefs({ feedViewPrefs: { 'at://did:plc:alice/app.bsky.feed.generator/x': { hideReposts: true } } })).toEqual(HOME_FEED_DEFAULTS)
  })
})

describe('rule 2: muted threads', () => {
  const muted = (e: AppBskyFeedDefs.FeedViewPost) => ({ ...e, post: { ...e.post, viewer: { threadMuted: true } } })
  it('drops a post, reply or repost in a thread the reader muted', () => {
    expect(show(muted(plain(alice, 'a1')))).toBe(false)
    expect(show(muted(reply(alice, 'a2', post(carol, 'c0'))))).toBe(false)
    expect(show(muted(repost(carol, aliceRoot)))).toBe(false)
    // The reader's own, too: the reader chose to mute it.
    expect(show(muted(plain(me, 'm1')))).toBe(false)
  })
})

describe('rule 3: the reader\'s own', () => {
  const all = { hideReplies: true, hideReposts: true, hideQuotePosts: true }
  it('shows the reader\'s own post, reply and repost under every pref', () => {
    expect(show(plain(me, 'm1'), all)).toBe(true)
    expect(show(reply(me, 'm2', bobRoot), all)).toBe(true)
    expect(show(repost(me, bobRoot), all)).toBe(true)
    expect(show(repost(me, post(bob, 'bq', { embed: quoteEmbed(aliceRoot) })), all)).toBe(true)
    expect(show({ post: post(me, 'm3', { embed: quoteEmbed(bobRoot) }) }, all)).toBe(true)
  })

  it('shows a reply to the reader, from anyone the reader follows, under every pref', () => {
    expect(show(reply(alice, 'a1', myRoot), all)).toBe(true)
    // Deep in an unfollowed author's thread, it is still to the reader.
    const mine = post(me, 'm4', { reply: { root: bobRoot.uri, parent: bobRoot.uri } })
    expect(show(reply(alice, 'a2', mine, bobRoot))).toBe(true)
  })
})

describe('rule 4: reposts', () => {
  it('shows a repost by default and hides it with hideReposts', () => {
    expect(show(repost(alice, bobRoot))).toBe(true)
    expect(show(repost(alice, bobRoot), { hideReposts: true })).toBe(false)
  })

  it('hideQuotePosts hides a reposted quote too', () => {
    const quote = post(bob, 'bq', { embed: quoteEmbed(aliceRoot) })
    expect(show(repost(carol, quote))).toBe(true)
    expect(show(repost(carol, quote), { hideQuotePosts: true })).toBe(false)
  })

  it('a reposted reply to an unfollowed author is a repost, not a reply', () => {
    const r = reply(alice, 'a1', bobRoot)
    expect(show({ ...repost(carol, r.post), reply: r.reply })).toBe(true)
  })

  it('6.1: a reposted reply with no reply hydration is an orphan; the reader\'s own repost still shows', () => {
    const r = reply(alice, 'a1', aliceRoot).post
    expect(show(repost(carol, r))).toBe(false)
    expect(show(repost(me, r))).toBe(true)
  })

  it('a repost has no reply context', () => {
    expect(replyContextViews(repost(carol, reply(alice, 'a1', aliceRoot).post))).toBeNull()
  })
})

describe('rule 5: quote posts', () => {
  const q = { post: post(alice, 'a1', { embed: quoteEmbed(bobRoot) }) }
  it('shows a quote post by default and hides it with hideQuotePosts', () => {
    expect(show(q)).toBe(true)
    expect(show(q, { hideQuotePosts: true })).toBe(false)
  })

  it('counts a quote with media and a gone quote; not a feed card or plain media (a difference from bsky.app)', () => {
    expect(isQuotePost(post(alice, 'x', { embed: { $type: 'app.bsky.embed.recordWithMedia#view', record: quoteEmbed(bobRoot), media: {} } }))).toBe(true)
    expect(isQuotePost(post(alice, 'x', { embed: { $type: 'app.bsky.embed.record#view', record: { $type: 'app.bsky.embed.record#viewNotFound', uri: bobRoot.uri } } }))).toBe(true)
    expect(isQuotePost(post(alice, 'x', { embed: { $type: 'app.bsky.embed.record#view', record: { $type: 'app.bsky.feed.defs#generatorView' } } }))).toBe(false)
    expect(isQuotePost(post(alice, 'x', { embed: { $type: 'app.bsky.embed.images#view', images: [] } }))).toBe(false)
  })
})

describe('rule 6: replies', () => {
  const a1 = post(alice, 'a1', { reply: { root: aliceRoot.uri, parent: aliceRoot.uri } })
  const selfThread = () => reply(alice, 'a2', a1, aliceRoot, { grand: alice })
  const c1 = post(carol, 'c1', { reply: { root: aliceRoot.uri, parent: aliceRoot.uri } })
  const mixed = () => reply(alice, 'a3', c1, aliceRoot, { grand: alice })

  it('6.1 hides an orphan: parent or root not a post view, or no reply hydration', () => {
    const notFound = { $type: 'app.bsky.feed.defs#notFoundPost', uri: uri(carol, 'gone'), notFound: true }
    const blocked = { $type: 'app.bsky.feed.defs#blockedPost', uri: uri(carol, 'gone'), blocked: true, author: { did: carol.did } }
    expect(show(reply(alice, 'a1', post(carol, 'c1'), notFound))).toBe(false)
    expect(show(reply(alice, 'a2', post(carol, 'c1'), blocked))).toBe(false)
    expect(show(reply(alice, 'a3', blocked as unknown as AppBskyFeedDefs.PostView, aliceRoot))).toBe(false)
    const noHydration = { post: reply(alice, 'a4', aliceRoot).post }
    expect(show(noHydration)).toBe(false)
  })

  it('6.2 hideReplies keeps a self-thread (one author all the way) and hides a mixed chain', () => {
    expect(show(selfThread(), { hideReplies: true })).toBe(true)
    expect(show(mixed(), { hideReplies: true })).toBe(false)
    expect(show(reply(alice, 'a5', post(carol, 'c0')), { hideReplies: true })).toBe(false)
    expect(show(plain(alice, 'a6'), { hideReplies: true })).toBe(true)
  })

  it('6.3 hides a reply from a followed author to an unfollowed one', () => {
    expect(show(reply(alice, 'a1', bobRoot))).toBe(false)
  })

  it('6.3 shows a reply between two followed authors, a self-thread and a mixed chain of followed authors', () => {
    expect(show(reply(alice, 'a1', post(carol, 'c0')))).toBe(true)
    expect(show(selfThread())).toBe(true)
    expect(show(mixed())).toBe(true)
  })

  it('6.3 shows a reply when the root or the grandparent author is followed', () => {
    const b1 = post(bob, 'b1', { reply: { root: post(carol, 'c0').uri, parent: post(carol, 'c0').uri } })
    expect(show(reply(alice, 'a1', b1, post(carol, 'c0')))).toBe(true)
    const b2 = post(bob, 'b2', { reply: { root: bobRoot.uri, parent: bobRoot.uri } })
    expect(show(reply(alice, 'a1', b2, bobRoot, { grand: carol }))).toBe(true)
    expect(show(reply(alice, 'a1', b2, bobRoot, { grand: bob }))).toBe(false)
  })

  it('6.3 hides a reply by an author the reader does not follow', () => {
    expect(show(reply(bob, 'b1', aliceRoot))).toBe(false)
  })
})

describe('rule 7: context', () => {
  it('a reply to the root: the parent only, no gap', () => {
    expect(replyContextViews(reply(alice, 'a1', aliceRoot))).toEqual({ root: null, parent: aliceRoot, gap: false })
  })

  it('a reply to a reply to the root: root and parent, no gap', () => {
    const c1 = post(carol, 'c1', { reply: { root: aliceRoot.uri, parent: aliceRoot.uri } })
    expect(replyContextViews(reply(alice, 'a2', c1, aliceRoot))).toEqual({ root: aliceRoot, parent: c1, gap: false })
  })

  it('posts skipped between root and parent: a gap', () => {
    const c2 = post(carol, 'c2', { reply: { root: aliceRoot.uri, parent: uri(carol, 'c1') } })
    expect(replyContextViews(reply(alice, 'a3', c2, aliceRoot))).toEqual({ root: aliceRoot, parent: c2, gap: true })
  })

  it('a root that is not a post view: the parent, and a gap when it is a reply', () => {
    const c1 = post(carol, 'c1', { reply: { root: uri(bob, 'gone'), parent: uri(bob, 'gone') } })
    const gone = { $type: 'app.bsky.feed.defs#notFoundPost', uri: uri(bob, 'gone'), notFound: true }
    expect(replyContextViews(reply(alice, 'a1', c1, gone))).toEqual({ root: null, parent: c1, gap: true })
  })

  it('no parent post view: no context; a plain post: none', () => {
    const gone = { $type: 'app.bsky.feed.defs#notFoundPost', uri: uri(bob, 'gone'), notFound: true }
    expect(replyContextViews(reply(alice, 'a1', gone as unknown as AppBskyFeedDefs.PostView, aliceRoot))).toBeNull()
    expect(replyContextViews(plain(alice, 'a2'))).toBeNull()
  })
})

describe('the client: Home', () => {
  function setup(o: { feed: AppBskyFeedDefs.FeedViewPost[]; prefs?: unknown; getPreferences?: () => Promise<unknown> }) {
    const agent = {
      did: ME,
      getTimeline: vi.fn(async () => ({ data: { feed: o.feed, cursor: 'next' } })),
      getPreferences: vi.fn(o.getPreferences ?? (async () => o.prefs ?? { feedViewPrefs: {} })),
      getAuthorFeed: vi.fn(), getPostThread: vi.fn(), getPosts: vi.fn(), getProfile: vi.fn(), getProfiles: vi.fn(),
      app: { bsky: { bookmark: { getBookmarks: vi.fn() }, graph: { getMutes: vi.fn(), getBlocks: vi.fn() }, feed: { getListFeed: vi.fn(async () => ({ data: { feed: o.feed } })) } } },
    }
    const client = createBlueskyClient({
      userKey: READER, agent: agent as unknown as BlueskyAgent,
      moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    })
    return { agent, client }
  }

  const c1 = post(carol, 'c1', { reply: { root: aliceRoot.uri, parent: aliceRoot.uri } })
  const feed = [
    reply(alice, 'a2', c1, aliceRoot), // shows, with root and parent
    reply(alice, 'a3', bobRoot), // to an unfollowed author: hidden
    plain(alice, 'a4'),
  ]

  it('rules 1, 6, 7: filters by the default prefs and carries the context, moderated', async () => {
    const { client } = setup({ feed })
    const page = await client.fetchTimeline('home')
    expect(page.map((s) => s.id)).toEqual([uri(alice, 'a2'), uri(alice, 'a4')])
    const ctx = page[0]!.bluesky!.replyContext!
    expect(ctx.root!.id).toBe(aliceRoot.uri)
    expect(ctx.parent.id).toBe(c1.uri)
    expect(ctx.gap).toBe(false)
    expect(ctx.parent.bluesky!.moderation).toEqual(moderationFor(c1.uri))
    expect(ctx.parent.bluesky!.viewerOf).toBe(READER)
    expect(page[1]!.bluesky!.replyContext).toBeUndefined()
    // A page the filter thins keeps its cursor.
    expect(page.nextCursor).toBe('next')
  })

  it('rule 1: follows the reader\'s prefs', async () => {
    const { client } = setup({ feed, prefs: { feedViewPrefs: { home: { hideReplies: true } } } })
    expect((await client.fetchTimeline('home')).map((s) => s.id)).toEqual([uri(alice, 'a4')])
  })

  it('rule 1: a failed prefs read is the defaults for that page, and the next page reads again', async () => {
    let fail = true
    const { agent, client } = setup({
      feed,
      getPreferences: async () => {
        if (fail) throw new Error('down')
        return { feedViewPrefs: { home: { hideReplies: true } } }
      },
    })
    expect((await client.fetchTimeline('home')).map((s) => s.id)).toEqual([uri(alice, 'a2'), uri(alice, 'a4')])
    fail = false
    expect((await client.fetchTimeline('home', { cursor: 'next' })).map((s) => s.id)).toEqual([uri(alice, 'a4')])
    expect(agent.getPreferences).toHaveBeenCalledTimes(2)
  })

  it('rule 1: reads the prefs once, and again after the TTL', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-10T12:00:00Z') })
    try {
      const { agent, client } = setup({ feed })
      await client.fetchTimeline('home')
      await client.fetchTimeline('home', { cursor: 'next' })
      expect(agent.getPreferences).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + HOME_PREFS_TTL_MS + 1)
      await client.fetchTimeline('home', { cursor: 'x' })
      expect(agent.getPreferences).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a catch-up filters too', async () => {
    const { client } = setup({ feed })
    const page = await client.fetchTimeline('home', { sinceId: uri(alice, 'a4') })
    expect(page.map((s) => s.id)).toEqual([uri(alice, 'a2'), uri(alice, 'a4')])
  })

  it('scope: a list feed is not filtered and has no context', async () => {
    const { agent, client } = setup({ feed })
    const page = await client.fetchTimeline({ type: 'list', id: '3lalicelist2a' })
    expect(page.map((s) => s.id)).toEqual([uri(alice, 'a2'), uri(alice, 'a3'), uri(alice, 'a4')])
    expect(page[0]!.bluesky!.replyContext).toBeUndefined()
    expect(agent.getPreferences).not.toHaveBeenCalled()
  })
})
