import type { AppBskyFeedDefs } from '@atproto/api'
import { createProfileStore, createTimelineStore } from '@beatzball/caribou-state'
import { describe, expect, it, vi } from 'vitest'
import { BOOKMARK_SKIP_PAGES, createBlueskyClient, type BlueskyAgent } from '../client.js'
import { fixture, moderationFor, READER } from './_helpers.js'

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))
vi.mock('../embeds.js', () => ({ mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, recordCard: null, quote: null })) }))

// Driven through the real stores. A list ends only on a null cursor
// (`packages/state` README), so a page that came back empty (every post
// unavailable, or every post failed to map) must keep older posts in reach.
const live = (n: string): AppBskyFeedDefs.PostView => ({
  ...fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json').feed[0]!.post,
  $type: 'app.bsky.feed.defs#postView', uri: `at://did:plc:bob/app.bsky.feed.post/${n}`, cid: `bafy${n}`,
})
const gone = (n: string) => ({ $type: 'app.bsky.feed.defs#notFoundPost', uri: `at://did:plc:bob/app.bsky.feed.post/${n}`, notFound: true })
const blocked = (n: string) => ({ $type: 'app.bsky.feed.defs#blockedPost', uri: `at://did:plc:bob/app.bsky.feed.post/${n}`, blocked: true, author: { did: 'did:plc:bob' } })
const bm = (item: object) => ({ subject: { uri: (item as { uri: string }).uri, cid: 'c' }, item })

type Pages = Record<string, { items: object[]; cursor?: string }>
const short = (ids: string[]) => ids.map((id) => id.split('/').pop())

function client(pages: Pages) {
  const respond = (cursor: string | undefined) => pages[cursor ?? '']!
  const getBookmarks = vi.fn(async ({ cursor }: { cursor?: string }) => {
    const p = respond(cursor)
    return { data: { bookmarks: p.items.map(bm), ...(p.cursor ? { cursor: p.cursor } : {}) } }
  })
  const feed = vi.fn(async ({ cursor }: { cursor?: string }) => {
    const p = respond(cursor)
    return { data: { feed: p.items.map((post) => ({ post })), ...(p.cursor ? { cursor: p.cursor } : {}) } }
  })
  const agent = {
    did: 'did:plc:reader', getTimeline: feed, getAuthorFeed: feed,
    app: { bsky: { bookmark: { getBookmarks }, graph: {} } },
  } as unknown as BlueskyAgent
  const onMapError = vi.fn()
  const c = createBlueskyClient({
    userKey: READER, agent, onMapError,
    // A post whose rkey starts with "bad" fails to map.
    moderation: {
      post: (v) => { if (/\/bad[^/]*$/.test(v.uri)) throw new Error('unmappable'); return moderationFor(v.uri) },
      profile: (v) => moderationFor(v.did),
    },
  })
  return { c, getBookmarks, feed, onMapError }
}

const stores = {
  home: (c: ReturnType<typeof client>['c']) => createTimelineStore('home', { clientSource: () => c }),
  bookmarks: (c: ReturnType<typeof client>['c']) => createTimelineStore('bookmarks', { clientSource: () => c }),
  profile: (c: ReturnType<typeof client>['c']) => createProfileStore('did:plc:bob', 'posts', { clientSource: () => c }),
}

describe('bookmarks with unavailable-only pages', () => {
  it('reads past an unavailable-only page: live, then gone and blocked, then live', async () => {
    const { c, getBookmarks } = client({
      '': { items: [live('a')], cursor: 'c1' },
      c1: { items: [gone('x'), blocked('y')], cursor: 'c2' },
      c2: { items: [live('b')] },
    })
    const store = stores.bookmarks(c)
    await store.load()
    await store.loadMore()
    expect(short(store.statusIds.value)).toEqual(['a', 'b'])
    expect(store.hasMore.value).toBe(false)
    expect(getBookmarks.mock.calls.map((x) => x[0].cursor)).toEqual([undefined, 'c1', 'c2'])
  })

  it('reads past an unavailable-only first page', async () => {
    const { c } = client({ '': { items: [gone('x')], cursor: 'c1' }, c1: { items: [live('a')], cursor: 'c2' }, c2: { items: [] } })
    const store = stores.bookmarks(c)
    await store.load()
    expect(short(store.statusIds.value)).toEqual(['a'])
    expect(store.hasMore.value).toBe(true)
  })

  it(`keeps a live page after ${BOOKMARK_SKIP_PAGES} unavailable pages in reach`, async () => {
    const pages: Pages = {}
    for (let i = 0; i < BOOKMARK_SKIP_PAGES; i++) pages[i === 0 ? '' : `c${i}`] = { items: [gone(`g${i}`)], cursor: `c${i + 1}` }
    pages[`c${BOOKMARK_SKIP_PAGES}`] = { items: [live('late')] }
    const { c, getBookmarks } = client(pages)
    // The client stops at its budget with the last cursor, not the end.
    const first = await c.fetchTimeline('bookmarks')
    expect(getBookmarks).toHaveBeenCalledTimes(BOOKMARK_SKIP_PAGES)
    expect(first).toHaveLength(0)
    expect(first.nextCursor).toBe(`c${BOOKMARK_SKIP_PAGES}`)
    // And the store reaches the live page.
    const store = stores.bookmarks(c)
    await store.load()
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    expect(short(store.statusIds.value)).toEqual(['late'])
    expect(store.hasMore.value).toBe(false)
  })
})

describe.each(['home', 'bookmarks', 'profile'] as const)('%s: a page where every post fails to map', (kind) => {
  it('does not end the list: live, then unmappable, then live', async () => {
    const { c, onMapError } = client({
      '': { items: [live('a')], cursor: 'c1' },
      c1: { items: [live('bad1'), live('bad2')], cursor: 'c2' },
      c2: { items: [live('b')] },
    })
    const store = stores[kind](c)
    await store.load()
    await store.loadMore()
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    expect(short(store.statusIds.value)).toEqual(['a', 'b'])
    expect(store.hasMore.value).toBe(false)
    expect(onMapError).toHaveBeenCalledTimes(2)
    expect(onMapError).toHaveBeenCalledWith(expect.any(Error), 'at://did:plc:bob/app.bsky.feed.post/bad1')
  })

  it('does not end the list when the first page is all unmappable', async () => {
    const { c } = client({ '': { items: [live('bad1')], cursor: 'c1' }, c1: { items: [live('a')] } })
    const store = stores[kind](c)
    await store.load()
    expect(store.statusIds.value).toEqual([])
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    expect(short(store.statusIds.value)).toEqual(['a'])
  })
})
