import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Status } from '@beatzball/caribou-mastodon-client'
import type { AppBskyFeedDefs } from '@atproto/api'
import { mapEmbed } from '../embeds.js'
import { mapPost } from '../map/post.js'
import type { MapContext } from '../map/context.js'
import * as fx from '../__fixtures__/embeds.js'

// `mapPost` belongs to #177. These tests check what `mapEmbed` hands it.
vi.mock('../map/post.js', () => ({ mapPost: vi.fn() }))
const mapPostMock = vi.mocked(mapPost)

const ctx: MapContext = { viewerOf: null, moderatePost: () => { throw new Error('unused') } }
type Embed = AppBskyFeedDefs.PostView['embed']
const map = (embed: unknown, postUri: string | undefined = fx.POST_URI) => mapEmbed(embed as Embed, ctx, postUri)

const FALLBACK_TITLE = 'Not supported here — open on bsky.app'
const quotedStatus = { id: 'at://did:plc:bob/app.bsky.feed.post/3kquoted' } as Status

beforeEach(() => {
  mapPostMock.mockReset()
  mapPostMock.mockReturnValue(quotedStatus)
})

describe('mapEmbed', () => {
  it('maps no embed (undefined or null) to nothing', () => {
    expect(map(null)).toEqual({ mediaAttachments: [], card: null, quote: null })
    expect(map(undefined)).toEqual({ mediaAttachments: [], card: null, quote: null })
  })

  it('maps images to image media with alt text and size', () => {
    const out = map(fx.imagesView)
    expect(out.card).toBeNull()
    expect(out.quote).toBeNull()
    expect(out.mediaAttachments).toEqual([
      {
        id: fx.imagesView.images[0]!.fullsize,
        type: 'image',
        url: fx.imagesView.images[0]!.fullsize,
        previewUrl: fx.imagesView.images[0]!.thumb,
        description: 'A caribou in the snow',
        meta: {
          original: { width: 2000, height: 1500, size: '2000x1500', aspect: 2000 / 1500 },
          small: { width: 2000, height: 1500, size: '2000x1500', aspect: 2000 / 1500 },
        },
      },
      {
        id: fx.imagesView.images[1]!.fullsize,
        type: 'image',
        url: fx.imagesView.images[1]!.fullsize,
        previewUrl: fx.imagesView.images[1]!.thumb,
        description: null,
        meta: null,
      },
    ])
  })

  it('keeps at most four images', () => {
    const one = fx.imagesView.images[1]!
    const images = [1, 2, 3, 4, 5].map((n) => ({ ...one, fullsize: `${one.fullsize}${n}` }))
    expect(map({ ...fx.imagesView, images }).mediaAttachments).toHaveLength(4)
  })

  it('drops an image whose URLs are not http(s)', () => {
    const images = [{ thumb: 'javascript:alert(1)', fullsize: 'data:image/png;base64,AA', alt: 'x' }]
    expect(map({ ...fx.imagesView, images }).mediaAttachments).toEqual([])
  })

  it('maps an external embed to a link card', () => {
    const out = map(fx.externalView)
    expect(out.mediaAttachments).toEqual([])
    expect(out.quote).toBeNull()
    expect(out.card).toEqual({
      url: 'https://example.com/article',
      title: 'An article',
      description: 'What the article is about.',
      type: 'link',
      image: fx.externalView.external.thumb,
      authors: [],
      embedUrl: '',
    })
  })

  it('maps a Tenor GIF like any external embed', () => {
    expect(map(fx.tenorGifView).card).toMatchObject({ url: fx.tenorGifView.external.uri, title: 'Dancing GIF', type: 'link' })
  })

  it('gives an external embed with no title its host as the title', () => {
    const out = map({ ...fx.externalView, external: { ...fx.externalView.external, title: '' } })
    expect(out.card?.title).toBe('example.com')
  })

  it('drops a thumb that is not http(s) and falls back on a link that is not', () => {
    const badThumb = map({ ...fx.externalView, external: { ...fx.externalView.external, thumb: 'javascript:x' } })
    expect(badThumb.card?.image).toBeNull()
    const badLink = map({ ...fx.externalView, external: { ...fx.externalView.external, uri: 'javascript:x' } })
    expect(badLink.card).toMatchObject({ title: FALLBACK_TITLE, url: fx.POST_URL })
  })

  it('maps a video to a thumbnail card that links to the post on bsky.app', () => {
    const out = map(fx.videoView)
    expect(out.mediaAttachments).toEqual([])
    expect(out.card).toEqual({
      url: fx.POST_URL,
      title: 'A caribou running',
      description: 'Play on bsky.app',
      type: 'video',
      image: fx.videoView.thumbnail,
      width: 1080,
      height: 1920,
      providerName: 'bsky.app',
      authors: [],
      embedUrl: '',
    })
  })

  it('titles a video with no alt text "Video"', () => {
    const { alt: _alt, ...noAlt } = fx.videoView
    expect(map(noAlt).card?.title).toBe('Video')
  })

  it('maps a quoted post through mapPost with the same ctx', () => {
    const out = map(fx.recordView)
    expect(out.quote).toEqual({ state: 'accepted', quotedStatus })
    expect(out.card).toBeNull()
    expect(out.mediaAttachments).toEqual([])
    expect(mapPostMock).toHaveBeenCalledTimes(1)
    const [view, passed] = mapPostMock.mock.calls[0]!
    expect(passed).toBe(ctx)
    expect(view).toEqual({
      uri: fx.viewRecord.uri,
      cid: fx.viewRecord.cid,
      author: fx.viewRecord.author,
      record: fx.quotedPostValue,
      embed: fx.imagesView,
      labels: [],
      likeCount: 3,
      replyCount: 1,
      repostCount: 2,
      quoteCount: 0,
      indexedAt: fx.viewRecord.indexedAt,
    })
  })

  it('keeps a quote with no post when mapPost throws', () => {
    mapPostMock.mockImplementation(() => { throw new Error('bad record') })
    expect(map(fx.recordView)).toEqual({ mediaAttachments: [], card: null, quote: { state: 'accepted', quotedStatus: null } })
  })

  it.each([
    ['not found', fx.notFoundView, 'deleted'],
    ['blocked', fx.blockedView, 'blocked_account'],
    ['detached', fx.detachedView, 'revoked'],
  ] as const)('maps a %s record to a quote with no post', (_name, view, state) => {
    expect(map(view)).toEqual({ mediaAttachments: [], card: null, quote: { state, quotedStatus: null } })
    expect(mapPostMock).not.toHaveBeenCalled()
  })

  it.each([
    ['feed', fx.feedGeneratorView, { url: 'https://bsky.app/profile/did:plc:alice/feed/caribous', title: 'Caribou pictures', description: 'Only caribou.', providerName: 'Bluesky feed', image: fx.feedGeneratorView.record.avatar }],
    ['list', fx.listView, { url: 'https://bsky.app/profile/did:plc:alice/lists/3klist', title: 'Herd', description: 'People who post caribou.', providerName: 'Bluesky list', image: null }],
    ['starter pack', fx.starterPackView, { url: 'https://bsky.app/starter-pack/alice.example.com/3kpack', title: 'Caribou fans', description: '', providerName: 'Bluesky starter pack', image: null }],
    ['labeler', fx.labelerView, { url: 'https://bsky.app/profile/did:plc:alice', title: 'Alice', description: '', providerName: 'Bluesky labeler', image: null }],
  ])('maps a %s to a small card linking to bsky.app', (_name, view, card) => {
    const out = map(view)
    expect(out.quote).toBeNull()
    expect(out.mediaAttachments).toEqual([])
    expect(out.card).toEqual({ ...card, type: 'link', authors: [], embedUrl: '' })
  })

  it('maps recordWithMedia images to a quote plus media', () => {
    const out = map(fx.recordWithImagesView)
    expect(out.quote).toEqual({ state: 'accepted', quotedStatus })
    expect(out.mediaAttachments).toHaveLength(2)
    expect(out.card).toBeNull()
  })

  it('maps recordWithMedia external to a quote plus a card', () => {
    const out = map(fx.recordWithExternalView)
    expect(out.quote).toEqual({ state: 'deleted', quotedStatus: null })
    expect(out.card?.url).toBe('https://example.com/article')
  })

  it('maps recordWithMedia video to a quote plus the video card', () => {
    const out = map(fx.recordWithVideoView)
    expect(out.quote?.state).toBe('accepted')
    expect(out.card?.type).toBe('video')
  })

  it('maps a feed with images to the feed card plus media', () => {
    const out = map(fx.feedWithImagesView)
    expect(out.quote).toBeNull()
    expect(out.card?.title).toBe('Caribou pictures')
    expect(out.mediaAttachments).toHaveLength(2)
  })

  it.each([
    ['an unknown embed $type', { $type: 'app.bsky.embed.hologram#view', data: 1 }],
    ['an unknown record $type', { $type: 'app.bsky.embed.record#view', record: { $type: 'com.example.thing#view' } }],
    ['an embed with no $type', { images: [] }],
    ['images that are not a list', { $type: 'app.bsky.embed.images#view', images: 'nope' }],
    ['external with no external', { $type: 'app.bsky.embed.external#view' }],
    ['record with no record', { $type: 'app.bsky.embed.record#view' }],
    ['a quoted record that is not a post', { $type: 'app.bsky.embed.record#view', record: { ...fx.viewRecord, value: { $type: 'app.bsky.graph.follow' } } }],
    ['recordWithMedia with unknown media', { $type: 'app.bsky.embed.recordWithMedia#view', record: fx.recordView, media: { $type: 'x#view' } }],
    ['a feed with a bad URI', { $type: 'app.bsky.embed.record#view', record: { ...fx.feedGeneratorView.record, uri: 'nope' } }],
    ['a string', 'embed'],
  ])('gives the fallback card for %s and never throws', (_name, embed) => {
    const out = map(embed)
    expect(out.card).toMatchObject({ title: FALLBACK_TITLE, url: fx.POST_URL, type: 'link' })
  })

  it('drops a size that is not a positive width and height', () => {
    const one = fx.imagesView.images[0]!
    for (const aspectRatio of [{ width: 0, height: 10 }, { width: '1', height: 2 }, null]) {
      expect(map({ ...fx.imagesView, images: [{ ...one, aspectRatio }] }).mediaAttachments[0]?.meta).toBeNull()
    }
  })

  it('uses the full image as the preview when the thumb is bad', () => {
    const one = { ...fx.imagesView.images[0]!, thumb: 'nope' }
    expect(map({ ...fx.imagesView, images: [one] }).mediaAttachments[0]?.previewUrl).toBe(one.fullsize)
  })

  it('names records with no title by what it can find', () => {
    const { displayName: _d, ...feed } = fx.feedGeneratorView.record
    expect(map({ ...fx.feedGeneratorView, record: feed }).card?.title).toBe('caribous')
    const { name: _n, ...list } = fx.listView.record
    expect(map({ ...fx.listView, record: list }).card?.title).toBe('3klist')
    const pack = { ...fx.starterPackView.record, record: {} }
    expect(map({ ...fx.starterPackView, record: pack }).card?.title).toBe('Starter pack')
    const labeler = { ...fx.labelerView.record, creator: { did: 'did:plc:alice', handle: 'alice.example.com' } }
    expect(map({ ...fx.labelerView, record: labeler }).card?.title).toBe('alice.example.com')
    const bare = { ...fx.labelerView.record, creator: { did: 'did:plc:alice' } }
    expect(map({ ...fx.labelerView, record: bare }).card?.title).toBe('did:plc:alice')
  })

  it.each([
    ['a list with a bad URI', { ...fx.listView, record: { ...fx.listView.record, uri: 'nope' } }],
    ['a starter pack with no creator handle', { ...fx.starterPackView, record: { ...fx.starterPackView.record, creator: { did: 'did:plc:alice' } } }],
    ['a labeler with no creator', { ...fx.labelerView, record: { ...fx.labelerView.record, creator: null, uri: 'nope' } }],
    ['a quoted record with no cid', { ...fx.recordView, record: { ...fx.viewRecord, cid: undefined } }],
  ])('gives the fallback card for %s', (_name, embed) => {
    expect(map(embed).card?.title).toBe(FALLBACK_TITLE)
  })

  it('maps a quoted record with no embeds or counts', () => {
    const { embeds: _e, likeCount: _l, ...bare } = fx.viewRecord
    map({ ...fx.recordView, record: bare })
    const [view] = mapPostMock.mock.calls[0]!
    expect(view).not.toHaveProperty('embed')
    expect(view).not.toHaveProperty('likeCount')
  })

  it('keeps the quote when only the media is unknown', () => {
    const out = map({ $type: 'app.bsky.embed.recordWithMedia#view', record: fx.recordView, media: { $type: 'x#view' } })
    expect(out.quote?.state).toBe('accepted')
    expect(out.mediaAttachments).toEqual([])
  })

  it('links the fallback card to bsky.app when it has no post URI', () => {
    expect(mapEmbed({ $type: 'x#view' } as unknown as Embed, ctx).card?.url).toBe('https://bsky.app')
    expect(map({ $type: 'x#view' }, 'not an at uri').card?.url).toBe('https://bsky.app')
  })
})
