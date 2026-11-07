import type { AppBskyFeedDefs } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { mapEmbed } from '../embeds.js'
import { renderFacets } from '../facets.js'
import { mapPost, parseAtUri, postRecord } from '../map/post.js'
import { ctx, fixture, moderationFor, READER } from './_helpers.js'

// facets (#178) and embeds (#179) belong to other workers. These tests pin
// what mapPost hands them and that it uses what they return.
vi.mock('../facets.js', () => ({
  renderFacets: vi.fn((text: string, facets: unknown[] | undefined) => `<p>[${facets?.length ?? 0}]${text}</p>`),
}))
vi.mock('../embeds.js', () => ({
  mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, quote: null })),
}))

const view = () => fixture<AppBskyFeedDefs.PostView>('post-view.json')

describe('mapPost', () => {
  it('maps the ids, url, author and dates', () => {
    const s = mapPost(view(), ctx)
    expect(s.id).toBe('at://did:plc:alice/app.bsky.feed.post/3lalicepost1')
    expect(s.uri).toBe(s.id)
    expect(s.url).toBe('https://bsky.app/profile/did:plc:alice/post/3lalicepost1')
    expect(s.createdAt).toBe('2026-11-05T10:00:00.000Z')
    expect(s.editedAt).toBeNull()
    expect(s.account.id).toBe('did:plc:alice')
    expect(s.account.acct).toBe('alice.example.com')
    expect(s.language).toBe('en')
  })

  it('renders the text with its facets', () => {
    const v = view()
    const s = mapPost(v, ctx)
    expect(renderFacets).toHaveBeenCalledWith('héllo 🌷 @bob.example.com #Caribou', (v.record as { facets: unknown }).facets)
    expect(s.content).toBe('<p>[2]héllo 🌷 @bob.example.com #Caribou</p>')
  })

  it('reads mentions by DID and tags from the facets, by byte offsets', () => {
    const s = mapPost(view(), ctx)
    expect(s.mentions).toEqual([{ id: 'did:plc:bob', username: 'bob.example.com', acct: 'bob.example.com', url: 'https://bsky.app/profile/did:plc:bob' }])
    expect(s.tags).toEqual([{ id: 'Caribou', name: 'Caribou', url: 'https://bsky.app/hashtag/Caribou' }])
  })

  it('names the mention by its DID when its byte range is out of the text', () => {
    const v = view()
    const rec = v.record as { facets: { index: { byteStart: number; byteEnd: number } }[] }
    rec.facets[0]!.index = { byteStart: 30, byteEnd: 99 }
    expect(mapPost(v, ctx).mentions[0]!.acct).toBe('did:plc:bob')
  })

  it('maps counts and the reply', () => {
    const s = mapPost(view(), ctx)
    expect([s.repliesCount, s.reblogsCount, s.favouritesCount, s.quotesCount]).toEqual([2, 3, 5, 1])
    expect(s.inReplyToId).toBe('at://did:plc:bob/app.bsky.feed.post/3lbobparent')
    expect(s.inReplyToAccountId).toBe('did:plc:bob')
    expect(s.bluesky!.replyRef).toEqual({
      root: { uri: 'at://did:plc:carol/app.bsky.feed.post/3lcarolroot', cid: 'bafyreicarolroot' },
      parent: { uri: 'at://did:plc:bob/app.bsky.feed.post/3lbobparent', cid: 'bafyreibobparent' },
    })
  })

  it('maps the viewer state into the flags and the record refs', () => {
    const s = mapPost(view(), ctx)
    expect(s.favourited).toBe(true)
    expect(s.reblogged).toBe(false)
    expect(s.bookmarked).toBe(true)
    expect(s.muted).toBe(false)
    expect(s.bluesky).toMatchObject({
      uri: s.id, cid: 'bafyreialicepost1',
      likeUri: 'at://did:plc:reader/app.bsky.feed.like/3lreaderlike', repostUri: null,
      replyDisabled: true, embeddingDisabled: false, viewerOf: READER,
    })
  })

  it('reads a public copy (no viewer) as no reader state', () => {
    const v = view()
    delete v.viewer
    const s = mapPost(v, { ...ctx, viewerOf: null })
    expect([s.favourited, s.reblogged, s.bookmarked, s.pinned]).toEqual([false, false, false, false])
    expect(s.bluesky).toMatchObject({ likeUri: null, repostUri: null, replyDisabled: false, embeddingDisabled: false, viewerOf: null })
  })

  it('has the fields Mastodon has and Bluesky lacks, empty', () => {
    const s = mapPost(view(), ctx)
    expect(s).toMatchObject({ visibility: 'public', sensitive: false, spoilerText: '', poll: null, emojis: [], reblog: null })
  })

  it('takes media, card and quote from mapEmbed', () => {
    const quote = { state: 'accepted' as const, quotedStatus: null }
    vi.mocked(mapEmbed).mockReturnValueOnce({ mediaAttachments: [], card: null, quote })
    const v = view()
    const s = mapPost(v, ctx)
    expect(mapEmbed).toHaveBeenLastCalledWith(v.embed, ctx)
    expect(s.quote).toBe(quote)
  })

  it('keeps moderation from the caller and the raw labels without the signature', () => {
    const s = mapPost(view(), ctx)
    expect(s.bluesky!.moderation).toEqual(moderationFor(s.id))
    expect(s.bluesky!.labels).toEqual([{
      src: 'did:plc:labeler', uri: s.id, cid: 'bafyreialicepost1', val: 'graphic-media', cts: '2026-11-05T10:01:00.000Z',
    }])
  })

  it('is plain data: JSON gives back the same post', () => {
    const s = mapPost(view(), ctx)
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('falls back to indexedAt when createdAt is missing or not a date', () => {
    const v = view()
    ;(v.record as { createdAt: string }).createdAt = 'yesterday'
    expect(mapPost(v, ctx).createdAt).toBe('2026-11-05T10:00:01.123Z')
  })

  it('maps a record that is not a post as empty text', () => {
    const v = view()
    v.record = { $type: 'app.bsky.feed.like' }
    const s = mapPost(v, ctx)
    expect(s.content).toBe('<p>[0]</p>')
    expect(s.inReplyToId).toBeNull()
    expect(s.language).toBeNull()
  })

  it('drops a malformed reply ref', () => {
    const v = view()
    ;(v.record as { reply: unknown }).reply = { root: { uri: 'x' } }
    expect(mapPost(v, ctx).bluesky!.replyRef).toBeNull()
  })
})

describe('helpers', () => {
  it('parseAtUri splits an AT URI and refuses anything else', () => {
    expect(parseAtUri('at://did:plc:alice/app.bsky.feed.post/3k')).toEqual({ did: 'did:plc:alice', collection: 'app.bsky.feed.post', rkey: '3k' })
    expect(parseAtUri('https://example.com')).toBeNull()
  })

  it('postRecord ignores fields of the wrong type', () => {
    expect(postRecord({ $type: 'app.bsky.feed.post', text: 'x', facets: 'no', langs: ['en', 3] })).toEqual({ text: 'x', langs: ['en'] })
    expect(postRecord(null)).toEqual({ text: '' })
  })
})
