import type { AppBskyFeedDefs } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { feedEntryId, mapFeedEntry } from '../map/feed-entry.js'
import { ctx, fixture, moderationFor } from './_helpers.js'

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))
vi.mock('../embeds.js', () => ({ mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, quote: null })) }))

const feed = () => fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json').feed

describe('feedEntryId (seam 8)', () => {
  it('is the post URI for a plain entry', () => {
    expect(feedEntryId(feed()[0]!)).toBe('at://did:plc:bob/app.bsky.feed.post/3lbobpost1')
  })

  it('is reason.uri for a repost', () => {
    expect(feedEntryId(feed()[1]!)).toBe('at://did:plc:bob/app.bsky.feed.repost/3lbobrepost')
  })

  it('falls back when a valid reasonRepost has no uri', () => {
    const entry = feed()[2]!
    const id = feedEntryId(entry)
    expect(id).toBe('repost:did:plc:reader:at://did:plc:carol/app.bsky.feed.post/3lcarolold:2026-11-05T09:10:00.000Z')
    expect(id).not.toBe(entry.post.uri)
    expect(id).not.toBe(entry.post.viewer!.repost)
    expect(id.startsWith('at://')).toBe(false)
  })

  it('gives two reposts of one post two ids, neither the post', () => {
    const [, a, b] = feed()
    expect(new Set([feedEntryId(a!), feedEntryId(b!), a!.post.uri]).size).toBe(3)
  })

  it('reads a pin or an unknown reason as a plain entry', () => {
    const entry = feed()[0]!
    expect(feedEntryId({ ...entry, reason: { $type: 'app.bsky.feed.defs#reasonPin' } })).toBe(entry.post.uri)
    expect(feedEntryId({ ...entry, reason: { $type: 'app.bsky.feed.defs#reasonSomethingNew' } })).toBe(entry.post.uri)
  })
})

describe('mapFeedEntry', () => {
  it('maps a plain entry as its post', () => {
    const s = mapFeedEntry(feed()[0]!, ctx)
    expect(s.id).toBe('at://did:plc:bob/app.bsky.feed.post/3lbobpost1')
    expect(s.reblog).toBeNull()
  })

  it('wraps a repost: the reposter, the repost time, the post inside', () => {
    const s = mapFeedEntry(feed()[1]!, ctx)
    expect(s).toMatchObject({
      id: 'at://did:plc:bob/app.bsky.feed.repost/3lbobrepost',
      createdAt: '2026-11-05T09:20:00.000Z', content: '', reblogsCount: 0, favouritesCount: 0,
      account: { id: 'did:plc:bob', acct: 'bob.example.com' },
      reblog: { id: 'at://did:plc:carol/app.bsky.feed.post/3lcarolold', content: '<p>an old post</p>' },
    })
    expect(s.url).toBe(s.reblog!.url)
  })

  it('marks the wrapper as a Bluesky resource with the post moderation', () => {
    const s = mapFeedEntry(feed()[1]!, ctx)
    expect(s.bluesky).toMatchObject({
      uri: 'at://did:plc:bob/app.bsky.feed.repost/3lbobrepost', cid: 'bafyreibobrepost',
      likeUri: null, repostUri: null, viewerOf: ctx.viewerOf,
    })
    expect(s.bluesky!.moderation).toEqual(moderationFor('at://did:plc:carol/app.bsky.feed.post/3lcarolold'))
  })

  it('wraps a repost without a uri under the fallback id, and keeps the reader repost on the post', () => {
    const s = mapFeedEntry(feed()[2]!, ctx)
    expect(s.id).toMatch(/^repost:/)
    expect(s.uri).toBe(s.id)
    expect(s.bluesky!.cid).toBe('')
    expect(s.reblog!.reblogged).toBe(true)
    expect(s.reblog!.bluesky!.repostUri).toBe('at://did:plc:reader/app.bsky.feed.repost/3lreaderrepost')
  })

  it('is plain data', () => {
    const s = mapFeedEntry(feed()[1]!, ctx)
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})
