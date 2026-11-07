import type { AppBskyFeedDefs } from '@atproto/api'
import type { MediaAttachment, MediaAttachmentMetaImage, PreviewCard, Quote, QuoteState } from '@beatzball/caribou-mastodon-client'
import type { MapContext } from './map/context.js'
import { mapPost } from './map/post.js'

/** The parts of a `Status` that come from a post's embed (spec 6.5 and 7.3). */
export interface EmbedParts {
  mediaAttachments: MediaAttachment[]
  card: PreviewCard | null
  quote: Quote | null
}

// The rules are in the README, "Embeds". Every view arrives as JSON from
// the AppView, so each field is checked here, not trusted from the types.

const BSKY = 'https://bsky.app'
const MAX_IMAGES = 4
const FALLBACK_TITLE = 'Not supported here — open on bsky.app'

type Obj = Record<string, unknown>

/** A shape that does not match its `$type`. `mapEmbed` turns it into the fallback card. */
class BadShape extends Error {}

function obj(v: unknown): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BadShape()
  return v as Obj
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function httpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : null
  } catch {
    return null
  }
}

// `at://<did>/<collection>/<rkey>` → its parts, or null.
function atUri(v: unknown): { did: string; collection: string; rkey: string } | null {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(str(v))
  return m ? { did: m[1]!, collection: m[2]!, rkey: m[3]! } : null
}

function postUrl(postUri: string | undefined): string {
  const at = atUri(postUri)
  return at ? `${BSKY}/profile/${at.did}/post/${at.rkey}` : BSKY
}

function card(fields: Pick<PreviewCard, 'url' | 'title' | 'description'> & Partial<PreviewCard>): PreviewCard {
  return { type: 'link', authors: [], embedUrl: '', ...fields }
}

function fallbackCard(postUri: string | undefined): PreviewCard {
  return card({ url: postUrl(postUri), title: FALLBACK_TITLE, description: '' })
}

function size(aspectRatio: unknown): MediaAttachmentMetaImage | null {
  if (typeof aspectRatio !== 'object' || aspectRatio === null) return null
  const { width, height } = aspectRatio as Obj
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return null
  return { width, height, size: `${width}x${height}`, aspect: width / height }
}

function mapImages(view: Obj): MediaAttachment[] {
  if (!Array.isArray(view.images)) throw new BadShape()
  const out: MediaAttachment[] = []
  for (const raw of view.images.slice(0, MAX_IMAGES)) {
    const image = obj(raw)
    const url = httpUrl(image.fullsize)
    const previewUrl = httpUrl(image.thumb) ?? url
    if (!url || !previewUrl) continue
    const dims = size(image.aspectRatio)
    out.push({
      id: url,
      type: 'image',
      url,
      previewUrl,
      description: str(image.alt) || null,
      meta: dims ? { original: dims, small: dims } : null,
    })
  }
  return out
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function mapExternal(view: Obj): PreviewCard {
  const external = obj(view.external)
  const url = httpUrl(external.uri)
  if (!url) throw new BadShape()
  return card({
    url,
    title: str(external.title) || hostOf(url),
    description: str(external.description),
    image: httpUrl(external.thumb),
  })
}

function mapVideo(view: Obj, postUri: string | undefined): PreviewCard {
  const dims = size(view.aspectRatio)
  return card({
    url: postUrl(postUri),
    title: str(view.alt) || 'Video',
    description: 'Play on bsky.app',
    type: 'video',
    image: httpUrl(view.thumbnail),
    ...(dims ? { width: dims.width, height: dims.height } : {}),
    providerName: 'bsky.app',
  })
}

// A quoted record → the post view `mapPost` reads. No `viewer`: the
// AppView sends none for a quoted record.
function toPostView(record: Obj): AppBskyFeedDefs.PostView {
  const value = obj(record.value)
  if (value.$type !== undefined && value.$type !== 'app.bsky.feed.post') throw new BadShape()
  if (!atUri(record.uri) || typeof record.cid !== 'string') throw new BadShape()
  const view: Obj = {
    uri: record.uri,
    cid: record.cid,
    author: obj(record.author),
    record: value,
    embed: Array.isArray(record.embeds) ? record.embeds[0] : undefined,
    labels: record.labels,
    likeCount: record.likeCount,
    replyCount: record.replyCount,
    repostCount: record.repostCount,
    quoteCount: record.quoteCount,
    indexedAt: record.indexedAt,
  }
  for (const key of Object.keys(view)) if (view[key] === undefined) delete view[key]
  return view as unknown as AppBskyFeedDefs.PostView
}

const STUB_STATES: Record<string, QuoteState> = {
  'app.bsky.embed.record#viewNotFound': 'deleted',
  'app.bsky.embed.record#viewBlocked': 'blocked_account',
  'app.bsky.embed.record#viewDetached': 'revoked',
}

// A feed, list, starter pack or labeler → a small card that opens it on bsky.app.
function recordCard(type: string, record: Obj): PreviewCard | null {
  const at = atUri(record.uri)
  const creator = typeof record.creator === 'object' && record.creator !== null ? record.creator as Obj : {}
  const did = str(creator.did) || at?.did || ''
  switch (type) {
    case 'app.bsky.feed.defs#generatorView':
      if (!at || !did) throw new BadShape()
      return card({
        url: `${BSKY}/profile/${did}/feed/${at.rkey}`,
        title: str(record.displayName) || at.rkey,
        description: str(record.description),
        image: httpUrl(record.avatar),
        providerName: 'Bluesky feed',
      })
    case 'app.bsky.graph.defs#listView':
      if (!at || !did) throw new BadShape()
      return card({
        url: `${BSKY}/profile/${did}/lists/${at.rkey}`,
        title: str(record.name) || at.rkey,
        description: str(record.description),
        image: httpUrl(record.avatar),
        providerName: 'Bluesky list',
      })
    case 'app.bsky.graph.defs#starterPackViewBasic': {
      const handle = str(creator.handle)
      if (!at || !handle) throw new BadShape()
      const inner = typeof record.record === 'object' && record.record !== null ? record.record as Obj : {}
      return card({
        url: `${BSKY}/starter-pack/${handle}/${at.rkey}`,
        title: str(inner.name) || 'Starter pack',
        description: str(inner.description),
        image: null,
        providerName: 'Bluesky starter pack',
      })
    }
    case 'app.bsky.labeler.defs#labelerView':
      if (!did) throw new BadShape()
      return card({
        url: `${BSKY}/profile/${did}`,
        title: str(creator.displayName) || str(creator.handle) || did,
        description: str(creator.description),
        image: null,
        providerName: 'Bluesky labeler',
      })
    default:
      return null
  }
}

function mapRecord(view: Obj, ctx: MapContext): Pick<EmbedParts, 'card' | 'quote'> {
  const record = obj(view.record)
  const type = str(record.$type)
  if (type === 'app.bsky.embed.record#viewRecord') {
    const postView = toPostView(record)
    let quotedStatus = null
    // `mapPost` is another module's; a throw there must not lose the post.
    try { quotedStatus = mapPost(postView, ctx) } catch { /* the card says "not available" */ }
    return { card: null, quote: { state: 'accepted', quotedStatus } }
  }
  const state = STUB_STATES[type]
  if (state) return { card: null, quote: { state, quotedStatus: null } }
  const linked = recordCard(type, record)
  if (!linked) throw new BadShape()
  return { card: linked, quote: null }
}

function mapMedia(view: Obj, postUri: string | undefined): Pick<EmbedParts, 'mediaAttachments' | 'card'> {
  switch (view.$type) {
    case 'app.bsky.embed.images#view': return { mediaAttachments: mapImages(view), card: null }
    case 'app.bsky.embed.external#view': return { mediaAttachments: [], card: mapExternal(view) }
    case 'app.bsky.embed.video#view': return { mediaAttachments: [], card: mapVideo(view, postUri) }
    default: throw new BadShape()
  }
}

function mapKnown(embed: Obj, ctx: MapContext, postUri: string | undefined): EmbedParts {
  if (embed.$type === 'app.bsky.embed.record#view') {
    return { mediaAttachments: [], ...mapRecord(embed, ctx) }
  }
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    const { card: recordCard, quote } = mapRecord(obj(embed.record), ctx)
    let media: Pick<EmbedParts, 'mediaAttachments' | 'card'>
    try {
      media = mapMedia(obj(embed.media), postUri)
    } catch {
      // The quote still shows; only the media is unknown.
      media = { mediaAttachments: [], card: fallbackCard(postUri) }
    }
    return { mediaAttachments: media.mediaAttachments, card: media.card ?? recordCard, quote }
  }
  return { quote: null, ...mapMedia(embed, postUri) }
}

/**
 * A post's embed view → media, card and quote (README, "Embeds"). An unknown
 * `$type`, or a shape that does not match its `$type`, becomes a "Not
 * supported here — open on bsky.app" card; it never throws. `ctx` maps a
 * quoted post the same way `mapPost` maps the outer one. `postUri` is the
 * post's AT URI, for the links a video and the fallback card open.
 */
export function mapEmbed(embed: AppBskyFeedDefs.PostView['embed'], ctx: MapContext, postUri?: string): EmbedParts {
  if (embed === undefined || embed === null) return { mediaAttachments: [], card: null, quote: null }
  try {
    return mapKnown(obj(embed), ctx, postUri)
  } catch {
    return { mediaAttachments: [], card: fallbackCard(postUri), quote: null }
  }
}
