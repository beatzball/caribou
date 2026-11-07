import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreviewCard, Status } from '@beatzball/caribou-mastodon-client'
import type { AppBskyFeedDefs } from '@atproto/api'
import { mapEmbed, type EmbedParts } from '../embeds.js'
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
const NONE: EmbedParts = { mediaAttachments: [], card: null, recordCard: null, quote: null }
const quotedStatus = { id: 'at://did:plc:bob/app.bsky.feed.post/3kquoted' } as Status
const cards = (out: EmbedParts): PreviewCard[] => [out.card, out.recordCard].filter((c): c is PreviewCard => c !== null)

beforeEach(() => {
  mapPostMock.mockReset()
  mapPostMock.mockReturnValue(quotedStatus)
})

describe('mapEmbed', () => {
  it('maps no embed (undefined or null) to nothing', () => {
    expect(map(null)).toEqual(NONE)
    expect(map(undefined)).toEqual(NONE)
  })

  it('maps images to image media with alt text and size', () => {
    const out = map(fx.imagesView)
    expect(cards(out)).toEqual([])
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

  it('maps a gallery like images, and skips an item it does not know', () => {
    const out = map(fx.galleryView)
    const item = fx.galleryView.items[0]!
    expect(out.mediaAttachments).toEqual([{
      id: item.fullsize,
      type: 'image',
      url: item.fullsize,
      previewUrl: item.thumbnail,
      description: 'First',
      meta: {
        original: { width: 1000, height: 1000, size: '1000x1000', aspect: 1 },
        small: { width: 1000, height: 1000, size: '1000x1000', aspect: 1 },
      },
    }])
    expect(cards(out)).toEqual([])
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

  it('normalizes URLs the way the app does', () => {
    const out = map({ ...fx.externalView, external: { ...fx.externalView.external, uri: 'HTTPS://Example.com/a b' } })
    expect(out.card?.url).toBe('https://example.com/a%20b')
  })

  it('maps an external embed to a link card', () => {
    const out = map(fx.externalView)
    expect(out.mediaAttachments).toEqual([])
    expect(out.quote).toBeNull()
    expect(out.recordCard).toBeNull()
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

  it('titles a video with no alt text "Video" and drops a bad thumbnail', () => {
    const { alt: _alt, ...noAlt } = fx.videoView
    expect(map(noAlt).card?.title).toBe('Video')
    expect(map({ ...fx.videoView, thumbnail: 'javascript:x' }).card?.image).toBeNull()
  })

  it('maps a quoted post through mapPost with the same ctx', () => {
    const out = map(fx.recordView)
    expect(out).toEqual({ ...NONE, quote: { state: 'accepted', quotedStatus } })
    expect(mapPostMock).toHaveBeenCalledTimes(1)
    const [view, passed] = mapPostMock.mock.calls[0]!
    expect(passed).toBe(ctx)
    expect(view).toEqual({
      uri: fx.viewRecord.uri,
      cid: fx.viewRecord.cid,
      author: fx.viewRecord.author,
      record: fx.quotedPostValue,
      embed: fx.imagesView,
      labels: fx.viewRecord.labels,
      likeCount: 3,
      replyCount: 1,
      repostCount: 2,
      quoteCount: 0,
      indexedAt: fx.viewRecord.indexedAt,
    })
  })

  it('hands moderation every input it reads, and they survive JSON', () => {
    map(fx.recordView)
    const [view] = mapPostMock.mock.calls[0]!
    const roundTrip = JSON.parse(JSON.stringify(view)) as typeof view
    for (const v of [view, roundTrip]) {
      expect(v.labels).toHaveLength(2)
      expect(v.labels).toEqual(fx.viewRecord.labels)
      expect(v.author.labels).toEqual(fx.viewRecord.author.labels)
      expect(v.author.viewer).toEqual({ muted: true, blockedBy: false })
      expect(v.record).toMatchObject({
        labels: { values: [{ val: 'graphic-media' }] },
        embed: { images: [{ alt: 'A caribou in the snow' }] },
      })
      expect(v.embed).toEqual(fx.imagesView)
    }
  })

  it('keeps a quote with no post when mapPost throws', () => {
    mapPostMock.mockImplementation(() => { throw new Error('bad record') })
    expect(map(fx.recordView)).toEqual({ ...NONE, quote: { state: 'accepted', quotedStatus: null } })
  })

  it('maps one level of quote; a quote inside it keeps no post, so the card shows a link', () => {
    // A self-referencing chain, through a bridge shaped like the real
    // `mapPost`: it maps its own embed with `mapEmbed`.
    const chain: Record<string, unknown> = { ...fx.viewRecord }
    const view = { $type: 'app.bsky.embed.record#view', record: chain }
    chain.embeds = [view]
    mapPostMock.mockImplementation((v, c) => ({ id: v.uri, ...mapEmbed(v.embed, c, v.uri) }) as unknown as Status)
    const out = map(view)
    expect(mapPostMock).toHaveBeenCalledTimes(1)
    const quoted = out.quote?.quotedStatus
    expect(quoted?.id).toBe(fx.viewRecord.uri)
    expect(quoted?.quote).toEqual({ state: 'accepted', quotedStatus: null })
    // And the next top-level post maps its quote again.
    expect(map(fx.recordView).quote?.quotedStatus).toBeTruthy()
  })

  it.each([
    ['not found', fx.notFoundView, 'deleted'],
    ['blocked by the reader', fx.blockedView, 'blocked_account'],
    ['blocking the reader', fx.blockedByView, 'unauthorized'],
    ['blocked between the authors', fx.blockedBetweenAuthorsView, 'unauthorized'],
    ['detached', fx.detachedView, 'revoked'],
  ] as const)('maps a %s record to a quote with no post', (_name, view, state) => {
    expect(map(view)).toEqual({ ...NONE, quote: { state, quotedStatus: null } })
    expect(mapPostMock).not.toHaveBeenCalled()
  })

  it.each([
    ['feed', fx.feedGeneratorView, { url: 'https://bsky.app/profile/did:plc:alice/feed/caribous', title: 'Caribou pictures', description: 'Only caribou.', providerName: 'Bluesky feed', image: fx.feedGeneratorView.record.avatar }],
    ['list', fx.listView, { url: 'https://bsky.app/profile/did:plc:alice/lists/3klist', title: 'Herd', description: 'People who post caribou.', providerName: 'Bluesky list', image: null }],
    ['starter pack', fx.starterPackView, { url: 'https://bsky.app/starter-pack/alice.example.com/3kpack', title: 'Caribou fans', description: '', providerName: 'Bluesky starter pack', image: null }],
    ['labeler', fx.labelerView, { url: 'https://bsky.app/profile/did:plc:alice', title: 'Alice', description: '', providerName: 'Bluesky labeler', image: null }],
  ])('maps a %s to a record card linking to bsky.app', (_name, view, card) => {
    expect(map(view)).toEqual({ ...NONE, recordCard: { ...card, type: 'link', authors: [], embedUrl: '' } })
  })

  it('encodes the path parts of a record link', () => {
    const feed = { ...fx.feedGeneratorView.record, uri: 'at://did:plc:alice/app.bsky.feed.generator/a?b#c' }
    expect(map({ ...fx.feedGeneratorView, record: feed }).recordCard?.url).toBe('https://bsky.app/profile/did:plc:alice/feed/a%3Fb%23c')
    const pack = { ...fx.starterPackView.record, creator: { did: 'did:plc:alice', handle: 'a/b' } }
    expect(map({ ...fx.starterPackView, record: pack }).recordCard?.url).toBe('https://bsky.app/starter-pack/a%2Fb/3kpack')
  })

  it('maps recordWithMedia images to a quote plus media', () => {
    const out = map(fx.recordWithImagesView)
    expect(out.quote).toEqual({ state: 'accepted', quotedStatus })
    expect(out.mediaAttachments).toHaveLength(2)
    expect(cards(out)).toEqual([])
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

  it.each([
    ['images', fx.feedWithImagesView, 2, null],
    ['an external link', fx.feedWithExternalView, 0, 'An article'],
    ['a video', fx.feedWithVideoView, 0, 'A caribou running'],
  ])('keeps a feed and its %s, each in its own field', (_name, view, media, cardTitle) => {
    const out = map(view)
    expect(out.quote).toBeNull()
    expect(out.mediaAttachments).toHaveLength(media)
    expect(out.card?.title ?? null).toBe(cardTitle)
    expect(out.recordCard).toMatchObject({ title: 'Caribou pictures', url: 'https://bsky.app/profile/did:plc:alice/feed/caribous' })
  })

  it.each([
    ['an unknown embed $type', { $type: 'app.bsky.embed.hologram#view', data: 1 }],
    ['an unknown record $type', { $type: 'app.bsky.embed.record#view', record: { $type: 'com.example.thing#view' } }],
    ['a record $type of __proto__', { $type: 'app.bsky.embed.record#view', record: { $type: '__proto__' } }],
    ['a record $type of constructor', { $type: 'app.bsky.embed.record#view', record: { $type: 'constructor' } }],
    ['a record $type of toString', { $type: 'app.bsky.embed.record#view', record: { $type: 'toString' } }],
    ['an embed $type of __proto__', JSON.parse('{"$type":"__proto__"}')],
    ['an embed $type of constructor', { $type: 'constructor' }],
    ['an embed with no $type', { images: [] }],
    ['images that are not a list', { $type: 'app.bsky.embed.images#view', images: 'nope' }],
    ['external with no external', { $type: 'app.bsky.embed.external#view' }],
    ['record with no record', { $type: 'app.bsky.embed.record#view' }],
    ['a quoted record that is not a post', { $type: 'app.bsky.embed.record#view', record: { ...fx.viewRecord, value: { $type: 'app.bsky.graph.follow' } } }],
    ['recordWithMedia with unknown media', { $type: 'app.bsky.embed.recordWithMedia#view', record: fx.recordView, media: { $type: 'x#view' } }],
    ['recordWithMedia with media $type toString', { $type: 'app.bsky.embed.recordWithMedia#view', record: fx.recordView, media: { $type: 'toString' } }],
    ['a feed with a bad URI', { $type: 'app.bsky.embed.record#view', record: { ...fx.feedGeneratorView.record, uri: 'nope' } }],
    ['a list with a bad URI', { ...fx.listView, record: { ...fx.listView.record, uri: 'nope' } }],
    ['a starter pack with no creator', { ...fx.starterPackView, record: { ...fx.starterPackView.record, creator: {} } }],
    ['a labeler with no creator', { ...fx.labelerView, record: { ...fx.labelerView.record, creator: null, uri: 'nope' } }],
    ['a quoted record with no cid', { ...fx.recordView, record: { ...fx.viewRecord, cid: undefined } }],
    ['a string', 'embed'],
  ])('gives one fallback card for %s and never throws', (_name, embed) => {
    const out = map(embed)
    expect(cards(out)).toEqual([expect.objectContaining({ title: FALLBACK_TITLE, url: fx.POST_URL, type: 'link' })])
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
  })

  it('keeps good media when the record is bad', () => {
    const out = map({ $type: 'app.bsky.embed.recordWithMedia#view', record: { $type: 'app.bsky.embed.record#view', record: { $type: 'x#view' } }, media: fx.imagesView })
    expect(out.mediaAttachments).toHaveLength(2)
    expect(out.recordCard?.title).toBe(FALLBACK_TITLE)
    expect(out.card).toBeNull()
    expect(out.quote).toBeNull()
  })

  it('keeps the quote when only the media is unknown', () => {
    const out = map({ $type: 'app.bsky.embed.recordWithMedia#view', record: fx.recordView, media: { $type: 'x#view' } })
    expect(out.quote?.state).toBe('accepted')
    expect(out.mediaAttachments).toEqual([])
    expect(out.card?.title).toBe(FALLBACK_TITLE)
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
    expect(map({ ...fx.feedGeneratorView, record: feed }).recordCard?.title).toBe('caribous')
    const { name: _n, ...list } = fx.listView.record
    expect(map({ ...fx.listView, record: list }).recordCard?.title).toBe('3klist')
    const pack = { ...fx.starterPackView.record, record: {} }
    expect(map({ ...fx.starterPackView, record: pack }).recordCard?.title).toBe('Starter pack')
    const labeler = { ...fx.labelerView.record, creator: { did: 'did:plc:alice', handle: 'alice.example.com' } }
    expect(map({ ...fx.labelerView, record: labeler }).recordCard?.title).toBe('alice.example.com')
    const bare = { ...fx.labelerView.record, creator: { did: 'did:plc:alice' } }
    expect(map({ ...fx.labelerView, record: bare }).recordCard?.title).toBe('did:plc:alice')
  })

  it('links a starter pack by DID when the creator has no handle', () => {
    const pack = { ...fx.starterPackView.record, creator: { did: 'did:plc:alice' } }
    expect(map({ ...fx.starterPackView, record: pack }).recordCard?.url).toBe('https://bsky.app/starter-pack/did:plc:alice/3kpack')
  })

  it('maps a quoted record with no embeds or counts', () => {
    const { embeds: _e, likeCount: _l, ...bare } = fx.viewRecord
    map({ ...fx.recordView, record: bare })
    const [view] = mapPostMock.mock.calls[0]!
    expect(view).not.toHaveProperty('embed')
    expect(view).not.toHaveProperty('likeCount')
  })

  describe('a link part that cannot be encoded', () => {
    // A lone surrogate is valid JSON (`"\ud800"`) but `encodeURIComponent` throws on it.
    const BAD_URI = JSON.parse('"at://did:plc:alice/app.bsky.feed.post/3k\\ud800"') as string
    it.each([
      ['an unknown embed', { $type: 'x#view' }, 'card'],
      ['an unknown record', { $type: 'app.bsky.embed.record#view', record: { $type: 'x#view' } }, 'recordCard'],
      ['a video', fx.videoView, 'card'],
    ] as const)('gives %s a card that links to the bsky.app root', (_name, embed, field) => {
      const out = map(embed, BAD_URI)
      expect(out[field]?.url).toBe('https://bsky.app')
    })

    it('links a record card with such a part to the bsky.app root', () => {
      const feed = { ...fx.feedGeneratorView.record, uri: JSON.parse('"at://did:plc:alice/app.bsky.feed.generator/a\\ud800"') }
      expect(map({ ...fx.feedGeneratorView, record: feed }).recordCard).toMatchObject({ title: 'Caribou pictures', url: 'https://bsky.app' })
    })
  })

  it('shows one fallback card when both the record and the media are unknown', () => {
    const out = map({ $type: 'app.bsky.embed.recordWithMedia#view', record: { $type: 'app.bsky.embed.record#view', record: { $type: 'x#view' } }, media: { $type: 'y#view' } })
    expect(cards(out)).toEqual([expect.objectContaining({ title: FALLBACK_TITLE })])
  })

  it('links the fallback card to bsky.app when it has no post URI', () => {
    expect(mapEmbed({ $type: 'x#view' } as unknown as Embed, ctx).card?.url).toBe('https://bsky.app')
    expect(map({ $type: 'x#view' }, 'not an at uri').card?.url).toBe('https://bsky.app')
  })
})
