import { beforeEach, describe, expect, it } from 'vitest'
import type { PreviewCard, Status, StatusBluesky } from '@beatzball/caribou-mastodon-client'
import { mapEmbed } from '@beatzball/caribou-bluesky-client'
import '../caribou-status-card.js'
import '../caribou-status-link-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import type { CaribouStatusLinkCard } from '../caribou-status-link-card.js'

// Spec 7.3: a Bluesky post can embed a feed (or list, starter pack,
// labeler) next to its media, and the reader sees and can follow both.
// The mapper puts the record in `bluesky.recordCard`; the status card
// shows it. A Mastodon post keeps "no link card when there is media".

const POST_URI = 'at://did:plc:alice/app.bsky.feed.post/3kpost'
const account = { id: 'did:plc:alice', acct: 'alice.example.com', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }

const feed = {
  $type: 'app.bsky.embed.record#view',
  record: {
    $type: 'app.bsky.feed.defs#generatorView',
    uri: 'at://did:plc:alice/app.bsky.feed.generator/caribous',
    cid: 'bafkfeed',
    did: 'did:web:feeds.example.com',
    creator: { did: 'did:plc:alice', handle: 'alice.example.com', labels: [] },
    displayName: 'Caribou pictures',
    indexedAt: '2026-10-01T00:00:00.000Z',
  },
}
const images = {
  $type: 'app.bsky.embed.images#view',
  images: [{
    thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkimg1@jpeg',
    fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/bafkimg1@jpeg',
    alt: 'A caribou',
  }],
}
const external = {
  $type: 'app.bsky.embed.external#view',
  external: { uri: 'https://example.com/article', title: 'An article', description: '' },
}
const video = {
  $type: 'app.bsky.embed.video#view',
  cid: 'bafkvideo',
  playlist: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/playlist.m3u8',
  thumbnail: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/thumbnail.jpg',
  aspectRatio: { width: 1280, height: 720 },
}

const ctx = { viewerOf: null, moderatePost: () => { throw new Error('unused') } }

// What `mapPost` (#177) builds from these parts, cut down to what the card reads.
function blueskyPost(embed: unknown): Status {
  const parts = mapEmbed(embed as Parameters<typeof mapEmbed>[0], ctx, POST_URI)
  const bluesky = {
    uri: POST_URI, cid: 'bafy', likeUri: null, repostUri: null, replyRef: null,
    replyDisabled: false, embeddingDisabled: false, labels: [],
    // A clean result: every context present, nothing covered.
    moderation: { contexts: Object.fromEntries(['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView'].map((c) => [c, { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }])), labelersCovered: [] }, viewerOf: null,
    recordCard: parts.recordCard,
  } as unknown as StatusBluesky
  return {
    id: POST_URI, content: '<p>x</p>', createdAt: '2026-11-01T00:00:00Z', account,
    mediaAttachments: parts.mediaAttachments, card: parts.card, quote: parts.quote, bluesky,
  } as unknown as Status
}

async function statusCard(status: unknown): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.status = status as CaribouStatusCard['status']
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const linkCards = (el: Element) =>
  [...el.shadowRoot!.querySelectorAll<CaribouStatusLinkCard>('caribou-status-link-card')]

async function shownCards(el: Element): Promise<{ title: string; href: string | null; play: boolean }[]> {
  const out = []
  for (const c of linkCards(el)) {
    await c.updateComplete
    const a = c.shadowRoot!.querySelector('a')
    out.push({ title: c.card?.title ?? '', href: a?.getAttribute('href') ?? null, play: !!c.shadowRoot!.querySelector('.play') })
  }
  return out
}

const FEED = { title: 'Caribou pictures', href: 'https://bsky.app/profile/did:plc:alice/feed/caribous', play: false }

describe('<caribou-status-card> Bluesky record next to media', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it('shows a feed with images: the images and the feed card', async () => {
    const el = await statusCard(blueskyPost({ $type: 'app.bsky.embed.recordWithMedia#view', record: feed, media: images }))
    expect(el.shadowRoot!.querySelector('caribou-status-media')).not.toBeNull()
    expect(await shownCards(el)).toEqual([FEED])
  })

  it('shows a feed with an external link: both cards', async () => {
    const el = await statusCard(blueskyPost({ $type: 'app.bsky.embed.recordWithMedia#view', record: feed, media: external }))
    expect(await shownCards(el)).toEqual([
      { title: 'An article', href: 'https://example.com/article', play: false },
      FEED,
    ])
  })

  it('shows a feed with a video: the player, and the feed card', async () => {
    const el = await statusCard(blueskyPost({ $type: 'app.bsky.embed.recordWithMedia#view', record: feed, media: video }))
    expect(el.shadowRoot!.querySelector('caribou-bluesky-video')).not.toBeNull()
    expect(await shownCards(el)).toEqual([FEED])
  })

  it('video rule 11: a video with no playlist keeps the play mark that links to bsky.app', async () => {
    const { playlist: _p, ...noPlaylist } = video
    const el = await statusCard(blueskyPost({ $type: 'app.bsky.embed.recordWithMedia#view', record: feed, media: noPlaylist }))
    expect(el.shadowRoot!.querySelector('caribou-bluesky-video')).toBeNull()
    expect(await shownCards(el)).toEqual([
      { title: 'Video', href: 'https://bsky.app/profile/did:plc:alice/post/3kpost', play: true },
      FEED,
    ])
  })

  it('shows a feed alone as its card', async () => {
    const el = await statusCard(blueskyPost(feed))
    expect(await shownCards(el)).toEqual([FEED])
  })
})

describe('<caribou-status-card> Mastodon cards are unchanged', () => {
  beforeEach(() => { document.body.replaceChildren() })

  const card = (over: Partial<PreviewCard> = {}): PreviewCard => ({
    url: 'https://news.example/story', title: 'A story', description: '', type: 'link',
    authors: [], embedUrl: '', image: 'https://files.example.social/card.png', width: 1200, height: 600, ...over,
  })
  const media = [{ id: '1', type: 'image', url: 'https://files.example.social/a.png', previewUrl: 'https://files.example.social/a.png' }]
  const post = (over: Record<string, unknown>) => ({
    id: '1', content: '<p>x</p>', createdAt: '2026-04-28T12:00:00Z',
    account: { ...account, id: '1', acct: 'alice' }, mediaAttachments: [], ...over,
  })

  it('shows no link card when the post has media', async () => {
    const el = await statusCard(post({ mediaAttachments: media, card: card() }))
    expect(linkCards(el)).toHaveLength(0)
  })

  it('shows a video card with no play mark', async () => {
    const el = await statusCard(post({ card: card({ type: 'video' }) }))
    expect(await shownCards(el)).toEqual([{ title: 'A story', href: 'https://news.example/story', play: false }])
  })

  it('video rule 11: a Mastodon video card with an embedUrl is never the player', async () => {
    const el = await statusCard(post({ card: card({ type: 'video', embedUrl: 'https://video.example/v.m3u8' }) }))
    expect(el.shadowRoot!.querySelector('caribou-bluesky-video')).toBeNull()
    expect(await shownCards(el)).toEqual([{ title: 'A story', href: 'https://news.example/story', play: false }])
  })
})
