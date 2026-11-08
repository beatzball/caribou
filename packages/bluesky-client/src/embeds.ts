import type { AppBskyFeedDefs } from '@atproto/api'
import type { MediaAttachment, MediaAttachmentMetaImage, PreviewCard, Quote, QuoteState } from '@beatzball/caribou-mastodon-client'
import type { MapContext } from './map/context.js'
import { mapPost } from './map/post.js'
import { isNoUnauthenticated } from './no-unauthenticated.js'

/** The parts of a `Status` that come from a post's embed (spec 6.5 and 7.3). */
export interface EmbedParts {
  mediaAttachments: MediaAttachment[]
  /** From the media: an external link, a video, or the fallback. Goes in `Status.card`. */
  card: PreviewCard | null
  /** From the record: a feed, list, starter pack or labeler. Goes in `Status.bluesky.recordCard`. */
  recordCard: PreviewCard | null
  quote: Quote | null
}

// The rules are in the README, "Embeds". Every view arrives as JSON from
// the AppView, so each field is checked here, not trusted from the types.
// `$type` is matched with `switch` or `===` only, never an object lookup:
// `__proto__` or `toString` would find an inherited property.

const BSKY = 'https://bsky.app'
const MAX_IMAGES = 4
const FALLBACK_TITLE = 'Not supported here — open on bsky.app'

type Obj = Record<string, unknown>

/** A shape that does not match its `$type`. It becomes the fallback card. */
class BadShape extends Error {}

function obj(v: unknown): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BadShape()
  return v as Obj
}

function objOrEmpty(v: unknown): Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Obj : {}
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

// The same rule as the app's `_http-url.ts`: http(s) only, normalized.
function httpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

// A bsky.app link from its path parts, each URL-encoded (a DID keeps its
// colons). Building a link never throws: a part that cannot be encoded
// (a lone surrogate is valid JSON, and `encodeURIComponent` throws on it)
// gives the bsky.app root.
function bskyLink(...parts: string[]): string {
  try {
    return `${BSKY}/${parts.map((p) => encodeURIComponent(p).replace(/%3A/gi, ':')).join('/')}`
  } catch {
    return BSKY
  }
}

// `at://<did>/<collection>/<rkey>` → its parts, or null.
function atUri(v: unknown): { did: string; collection: string; rkey: string } | null {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(str(v))
  return m ? { did: m[1]!, collection: m[2]!, rkey: m[3]! } : null
}

function postUrl(postUri: string | undefined): string {
  const at = atUri(postUri)
  return at ? bskyLink('profile', at.did, 'post', at.rkey) : BSKY
}

function card(fields: Pick<PreviewCard, 'url' | 'title' | 'description'> & Partial<PreviewCard>): PreviewCard {
  return { type: 'link', authors: [], embedUrl: '', ...fields }
}

// The fallback cards this module built, so a dedupe goes by where a card
// came from, never by its title: a real feed or link may carry any title.
const FALLBACKS = new WeakSet<PreviewCard>()

function fallbackCard(postUri: string | undefined): PreviewCard {
  const out = card({ url: postUrl(postUri), title: FALLBACK_TITLE, description: '' })
  FALLBACKS.add(out)
  return out
}

function isFallback(c: PreviewCard | null): boolean {
  return c !== null && FALLBACKS.has(c)
}

function size(aspectRatio: unknown): MediaAttachmentMetaImage | null {
  if (typeof aspectRatio !== 'object' || aspectRatio === null) return null
  const { width, height } = aspectRatio as Obj
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return null
  return { width, height, size: `${width}x${height}`, aspect: width / height }
}

function image(fullsize: unknown, thumb: unknown, alt: unknown, aspectRatio: unknown): MediaAttachment | null {
  const url = httpUrl(fullsize)
  const previewUrl = httpUrl(thumb) ?? url
  if (!url || !previewUrl) return null
  const dims = size(aspectRatio)
  return {
    id: url,
    type: 'image',
    url,
    previewUrl,
    description: str(alt) || null,
    meta: dims ? { original: dims, small: dims } : null,
  }
}

function mapImages(view: Obj): MediaAttachment[] {
  if (!Array.isArray(view.images)) throw new BadShape()
  return view.images.slice(0, MAX_IMAGES)
    .map((raw) => { const i = obj(raw); return image(i.fullsize, i.thumb, i.alt, i.aspectRatio) })
    .filter((m): m is MediaAttachment => m !== null)
}

// A gallery is images by another name (`thumbnail` for `thumb`). An item
// of a kind this build does not know is skipped.
function mapGallery(view: Obj): MediaAttachment[] {
  if (!Array.isArray(view.items)) throw new BadShape()
  return view.items
    .map(objOrEmpty)
    .filter((i) => i.$type === undefined || i.$type === 'app.bsky.embed.gallery#viewImage')
    .slice(0, MAX_IMAGES)
    .map((i) => image(i.fullsize, i.thumbnail, i.alt, i.aspectRatio))
    .filter((m): m is MediaAttachment => m !== null)
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
// AppView sends none for a quoted record. Every input moderation reads
// (labels, author, raw record, embed) passes through as it came.
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

// How many quoted posts `mapEmbed` is inside right now. Bluesky shows one
// level of quote; a quote inside a quote keeps no post, and the quote card
// shows it as a link. This also ends a chain that quotes itself. Mapping
// is synchronous, so a module counter is safe.
let quoteDepth = 0

function mapQuoted(record: Obj, ctx: MapContext): Quote {
  const postView = toPostView(record)
  // Spec 8.3. A signed-out copy (`viewerOf` null: the server, or a reader
  // with no Bluesky account active) never carries this author's post. The
  // SDK filters the outer post from signed-out lists (`contentList.filter`)
  // but leaves its thread view alone, and the quote would still carry the
  // post. So the quote hides it here. The post is never mapped, so none of
  // it is kept.
  if (ctx.viewerOf === null && isNoUnauthenticated(postView.author)) {
    return { state: 'unauthorized', quotedStatus: null, bluesky: { hidden: 'no-unauthenticated' } }
  }
  if (quoteDepth > 0) return { state: 'accepted', quotedStatus: null }
  quoteDepth++
  try {
    return { state: 'accepted', quotedStatus: mapPost(postView, ctx) }
  } catch {
    // `mapPost` is another module's; a throw there must not lose the post.
    return { state: 'accepted', quotedStatus: null }
  } finally {
    quoteDepth--
  }
}

// The reader blocked the author: the card says so. Any other block (the
// author blocked the reader, or the two authors) only says "cannot see".
function blockedState(record: Obj): QuoteState {
  const viewer = objOrEmpty(objOrEmpty(record.author).viewer)
  return typeof viewer.blocking === 'string' && viewer.blocking !== '' ? 'blocked_account' : 'unauthorized'
}

// A feed, list, starter pack or labeler → a small card that opens it on bsky.app.
function recordCard(type: string, record: Obj): PreviewCard {
  const at = atUri(record.uri)
  const creator = objOrEmpty(record.creator)
  const did = str(creator.did) || at?.did || ''
  switch (type) {
    case 'app.bsky.feed.defs#generatorView':
      if (!at || !did) throw new BadShape()
      return card({
        url: bskyLink('profile', did, 'feed', at.rkey),
        title: str(record.displayName) || at.rkey,
        description: str(record.description),
        image: httpUrl(record.avatar),
        providerName: 'Bluesky feed',
      })
    case 'app.bsky.graph.defs#listView':
      if (!at || !did) throw new BadShape()
      return card({
        url: bskyLink('profile', did, 'lists', at.rkey),
        title: str(record.name) || at.rkey,
        description: str(record.description),
        image: httpUrl(record.avatar),
        providerName: 'Bluesky list',
      })
    case 'app.bsky.graph.defs#starterPackViewBasic': {
      const who = str(creator.handle) || str(creator.did)
      if (!at || !who) throw new BadShape()
      const inner = objOrEmpty(record.record)
      return card({
        url: bskyLink('starter-pack', who, at.rkey),
        title: str(inner.name) || 'Starter pack',
        description: str(inner.description),
        image: null,
        providerName: 'Bluesky starter pack',
      })
    }
    case 'app.bsky.labeler.defs#labelerView':
      if (!did) throw new BadShape()
      return card({
        url: bskyLink('profile', did),
        title: str(creator.displayName) || str(creator.handle) || did,
        description: str(creator.description),
        image: null,
        providerName: 'Bluesky labeler',
      })
    default:
      throw new BadShape()
  }
}

/** The note that takes the place of an author who asked not to be seen signed out (spec 8.3). */
export const NO_UNAUTHENTICATED_NOTE = 'This account asked to be seen only by signed-in readers.'

// A record card whose creator asked not to be seen signed out: the note,
// linking to bsky.app, with nothing from the record.
function hiddenCreatorCard(): PreviewCard {
  return card({ url: `${BSKY}`, title: NO_UNAUTHENTICATED_NOTE, description: '', image: null, providerName: 'Bluesky' })
}

type RecordPart = Pick<EmbedParts, 'recordCard' | 'quote'>

function mapRecordStrict(view: Obj, ctx: MapContext): RecordPart {
  const record = obj(view.record)
  const type = str(record.$type)
  switch (type) {
    case 'app.bsky.embed.record#viewRecord':
      return { recordCard: null, quote: mapQuoted(record, ctx) }
    case 'app.bsky.embed.record#viewNotFound':
      return { recordCard: null, quote: { state: 'deleted', quotedStatus: null } }
    case 'app.bsky.embed.record#viewBlocked':
      return { recordCard: null, quote: { state: blockedState(record), quotedStatus: null } }
    case 'app.bsky.embed.record#viewDetached':
      return { recordCard: null, quote: { state: 'revoked', quotedStatus: null } }
    default: {
      const built = recordCard(type, record)
      // Spec 8.3: a signed-out copy never carries the creator's name, text
      // or image when the creator asked not to be seen so. A known shape
      // only: a bad one is still the fallback card.
      if (ctx.viewerOf === null && isNoUnauthenticated(objOrEmpty(record.creator))) {
        return { recordCard: hiddenCreatorCard(), quote: null }
      }
      return { recordCard: built, quote: null }
    }
  }
}

// A record this build cannot map becomes the fallback card, in the record's
// place; the media next to it still shows.
function mapRecord(view: unknown, ctx: MapContext, postUri: string | undefined): RecordPart {
  try {
    return mapRecordStrict(obj(view), ctx)
  } catch {
    return { recordCard: fallbackCard(postUri), quote: null }
  }
}

type MediaPart = Pick<EmbedParts, 'mediaAttachments' | 'card'>

function mapMediaStrict(view: Obj, postUri: string | undefined): MediaPart {
  switch (view.$type) {
    case 'app.bsky.embed.images#view': return { mediaAttachments: mapImages(view), card: null }
    case 'app.bsky.embed.gallery#view': return { mediaAttachments: mapGallery(view), card: null }
    case 'app.bsky.embed.external#view': return { mediaAttachments: [], card: mapExternal(view) }
    case 'app.bsky.embed.video#view': return { mediaAttachments: [], card: mapVideo(view, postUri) }
    default: throw new BadShape()
  }
}

// Media this build cannot map becomes the fallback card; the record next
// to it still shows.
function mapMedia(view: unknown, postUri: string | undefined): MediaPart {
  try {
    return mapMediaStrict(obj(view), postUri)
  } catch {
    return { mediaAttachments: [], card: fallbackCard(postUri) }
  }
}

const NO_RECORD: RecordPart = { recordCard: null, quote: null }

/**
 * A post's embed view → media, cards and quote (README, "Embeds"). An
 * unknown `$type`, or a shape that does not match its `$type`, becomes a
 * "Not supported here — open on bsky.app" card; it never throws. `ctx` maps
 * a quoted post the same way `mapPost` maps the outer one. `postUri` is the
 * post's AT URI, for the links a video and the fallback card open.
 */
export function mapEmbed(embed: AppBskyFeedDefs.PostView['embed'], ctx: MapContext, postUri?: string): EmbedParts {
  if (embed === undefined || embed === null) return { mediaAttachments: [], card: null, ...NO_RECORD }
  const view = objOrEmpty(embed)
  switch (view.$type) {
    case 'app.bsky.embed.record#view':
      return { mediaAttachments: [], card: null, ...mapRecord(view, ctx, postUri) }
    case 'app.bsky.embed.recordWithMedia#view': {
      const media = mapMedia(view.media, postUri)
      const record = mapRecord(view.record, ctx, postUri)
      // Both halves unknown: one fallback card says it once.
      const twice = isFallback(media.card) && isFallback(record.recordCard)
      return { ...media, ...record, ...(twice ? { recordCard: null } : {}) }
    }
    default:
      return { ...mapMedia(view, postUri), ...NO_RECORD }
  }
}
