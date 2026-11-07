import type { AppBskyFeedDefs } from '@atproto/api'
import { createTimelineStore } from '@beatzball/caribou-state'
import { describe, expect, it, vi } from 'vitest'
import { BOOKMARK_SKIP_PAGES, createBlueskyClient, type BlueskyAgent } from '../client.js'
import { fixture, moderationFor, READER } from './_helpers.js'

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))
vi.mock('../embeds.js', () => ({ mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, quote: null })) }))

// The store stops at an empty page (`hasMore` is false). A page of only
// deleted or blocked bookmarks must not look empty, or every older bookmark
// is out of reach. Driven through the real timeline store.
const live = (n: string): AppBskyFeedDefs.PostView => ({
  ...fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json').feed[0]!.post,
  $type: 'app.bsky.feed.defs#postView', uri: `at://did:plc:bob/app.bsky.feed.post/${n}`, cid: `bafy${n}`,
})
const gone = (n: string) => ({ $type: 'app.bsky.feed.defs#notFoundPost', uri: `at://did:plc:bob/app.bsky.feed.post/${n}`, notFound: true })
const blocked = (n: string) => ({ $type: 'app.bsky.feed.defs#blockedPost', uri: `at://did:plc:bob/app.bsky.feed.post/${n}`, blocked: true, author: { did: 'did:plc:bob' } })
const bm = (item: object) => ({ subject: { uri: (item as { uri: string }).uri, cid: 'c' }, item })

function setup(pages: Record<string, { items: object[]; cursor?: string }>) {
  const getBookmarks = vi.fn(async ({ cursor }: { cursor?: string }) => {
    const p = pages[cursor ?? '']!
    return { data: { bookmarks: p.items.map(bm), ...(p.cursor ? { cursor: p.cursor } : {}) } }
  })
  const agent = { did: 'did:plc:reader', app: { bsky: { bookmark: { getBookmarks }, graph: {} } } } as unknown as BlueskyAgent
  const client = createBlueskyClient({
    userKey: READER, agent, moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
  })
  const store = createTimelineStore('bookmarks', { clientSource: () => client })
  return { getBookmarks, client, store }
}

describe('bookmarks with unavailable-only pages', () => {
  it('reads past an unavailable-only page: live, then gone and blocked, then live', async () => {
    const { store, getBookmarks } = setup({
      '': { items: [live('a')], cursor: 'c1' },
      c1: { items: [gone('x'), blocked('y')], cursor: 'c2' },
      c2: { items: [live('b')] },
    })
    await store.load()
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    expect(store.statusIds.value.map((id) => id.split('/').pop())).toEqual(['a', 'b'])
    expect(store.hasMore.value).toBe(false)
    expect(getBookmarks.mock.calls.map((c) => c[0].cursor)).toEqual([undefined, 'c1', 'c2'])
  })

  it('reads past an unavailable-only first page', async () => {
    const { store } = setup({
      '': { items: [gone('x')], cursor: 'c1' },
      c1: { items: [live('a')], cursor: 'c2' },
      c2: { items: [] },
    })
    await store.load()
    expect(store.statusIds.value.map((id) => id.split('/').pop())).toEqual(['a'])
    expect(store.hasMore.value).toBe(true)
  })

  it(`stops after ${BOOKMARK_SKIP_PAGES} unavailable-only pages and ends the page there`, async () => {
    const pages: Record<string, { items: object[]; cursor?: string }> = {}
    for (let i = 0; i < 10; i++) pages[i === 0 ? '' : `c${i}`] = { items: [gone(`g${i}`)], cursor: `c${i + 1}` }
    const { client, getBookmarks } = setup(pages)
    const res = await client.fetchTimeline('bookmarks')
    expect(getBookmarks).toHaveBeenCalledTimes(BOOKMARK_SKIP_PAGES)
    expect(res).toHaveLength(0)
    expect(res.nextCursor).toBeNull()
  })
})
