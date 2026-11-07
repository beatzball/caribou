import type { AppBskyFeedDefs, AppBskyRichtextFacet } from '@atproto/api'
import type { Status, StatusMention, Tag } from '@beatzball/caribou-mastodon-client'
import { mapEmbed } from '../embeds.js'
import { renderFacets } from '../facets.js'
import type { MapContext } from './context.js'
import { mapAccount } from './account.js'
import { mapLabels } from './labels.js'

/** The parts of an `app.bsky.feed.post` record the mapper reads. */
interface PostRecord {
  text: string
  facets?: AppBskyRichtextFacet.Main[]
  createdAt?: string
  langs?: string[]
  reply?: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isStrongRef(v: unknown): v is { uri: string; cid: string } {
  return isObject(v) && typeof v.uri === 'string' && typeof v.cid === 'string'
}

function isByteIndex(v: unknown): v is { byteStart: number; byteEnd: number } {
  return isObject(v) && Number.isInteger(v.byteStart) && Number.isInteger(v.byteEnd)
}

/**
 * The facets a record really has. A record is author-written and reaches the
 * AppView as written, so a facet can be anything. One that is not an object,
 * has no numeric byte index, or has no feature object is dropped (spec 7.1);
 * so are features that are not objects. The post stays readable.
 */
export function validFacets(facets: readonly unknown[]): AppBskyRichtextFacet.Main[] {
  return facets.flatMap((f): AppBskyRichtextFacet.Main[] => {
    if (!isObject(f) || !isByteIndex(f.index) || !Array.isArray(f.features)) return []
    const features = f.features.filter((x): x is { $type: string } => isObject(x) && typeof x.$type === 'string')
    if (features.length === 0) return []
    return [{ ...f, index: { byteStart: f.index.byteStart, byteEnd: f.index.byteEnd }, features } as AppBskyRichtextFacet.Main]
  })
}

/** The record as a post, or an empty post when it is not one. */
export function postRecord(record: unknown): PostRecord {
  if (!isObject(record) || record.$type !== 'app.bsky.feed.post' || typeof record.text !== 'string') {
    return { text: '' }
  }
  const reply = isObject(record.reply) && isStrongRef(record.reply.root) && isStrongRef(record.reply.parent)
    ? { root: { uri: record.reply.root.uri, cid: record.reply.root.cid }, parent: { uri: record.reply.parent.uri, cid: record.reply.parent.cid } }
    : undefined
  return {
    text: record.text,
    ...(Array.isArray(record.facets) ? { facets: validFacets(record.facets) } : {}),
    ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
    ...(Array.isArray(record.langs) ? { langs: record.langs.filter((l): l is string => typeof l === 'string') } : {}),
    ...(reply ? { reply } : {}),
  }
}

/** `at://<did>/<collection>/<rkey>` → its parts, or null. */
export function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri)
  return m ? { did: m[1]!, collection: m[2]!, rkey: m[3]! } : null
}

/** The post's page on bsky.app. */
export function postUrl(view: AppBskyFeedDefs.PostView): string {
  const rkey = parseAtUri(view.uri)?.rkey ?? ''
  return `https://bsky.app/profile/${view.author.did}/post/${rkey}`
}

function validDate(s: string | undefined): s is string {
  return s !== undefined && !Number.isNaN(Date.parse(s))
}

const MENTION = 'app.bsky.richtext.facet#mention'
const TAG = 'app.bsky.richtext.facet#tag'

// The visible text of a facet: its byte range, decoded. Out of range is ''.
function facetText(bytes: Uint8Array, facet: AppBskyRichtextFacet.Main): string {
  const { byteStart, byteEnd } = facet.index
  if (byteStart < 0 || byteEnd > bytes.length || byteStart >= byteEnd) return ''
  return new TextDecoder().decode(bytes.subarray(byteStart, byteEnd))
}

function mentionsAndTags(rec: PostRecord): { mentions: StatusMention[]; tags: Tag[] } {
  const mentions: StatusMention[] = []
  const tags: Tag[] = []
  if (!rec.facets?.length) return { mentions, tags }
  const bytes = new TextEncoder().encode(rec.text)
  const seenDids = new Set<string>()
  const seenTags = new Set<string>()
  for (const facet of rec.facets) {
    for (const feature of facet.features) {
      const f = feature as { $type: string; did?: unknown; tag?: unknown }
      if (f.$type === MENTION && typeof f.did === 'string' && !seenDids.has(f.did)) {
        seenDids.add(f.did)
        const acct = facetText(bytes, facet).replace(/^@/, '') || f.did
        mentions.push({ id: f.did, username: acct, acct, url: `https://bsky.app/profile/${f.did}` })
      } else if (f.$type === TAG && typeof f.tag === 'string' && f.tag && !seenTags.has(f.tag.toLowerCase())) {
        seenTags.add(f.tag.toLowerCase())
        tags.push({ id: f.tag, name: f.tag, url: `https://bsky.app/hashtag/${encodeURIComponent(f.tag)}` })
      }
    }
  }
  return { mentions, tags }
}

/**
 * One post view → a Caribou `Status` (spec 6.5; rules in the README). Calls
 * `mapEmbed` for the media, card and quote. Moderation comes from
 * `ctx.moderatePost`.
 */
export function mapPost(view: AppBskyFeedDefs.PostView, ctx: MapContext): Status {
  const rec = postRecord(view.record)
  const viewer = view.viewer ?? {}
  const parentUri = rec.reply?.parent.uri ?? null
  const embed = mapEmbed(view.embed, ctx)
  return {
    id: view.uri,
    uri: view.uri,
    url: postUrl(view),
    createdAt: validDate(rec.createdAt) ? rec.createdAt : view.indexedAt,
    editedAt: null,
    account: mapAccount(view.author),
    content: renderFacets(rec.text, rec.facets),
    visibility: 'public',
    sensitive: false,
    spoilerText: '',
    mediaAttachments: embed.mediaAttachments,
    card: embed.card,
    quote: embed.quote,
    ...mentionsAndTags(rec),
    emojis: [],
    reblogsCount: view.repostCount ?? 0,
    favouritesCount: view.likeCount ?? 0,
    repliesCount: view.replyCount ?? 0,
    quotesCount: view.quoteCount ?? 0,
    inReplyToId: parentUri,
    inReplyToAccountId: parentUri ? parseAtUri(parentUri)?.did ?? null : null,
    reblog: null,
    poll: null,
    language: rec.langs?.[0] ?? null,
    favourited: viewer.like != null,
    reblogged: viewer.repost != null,
    bookmarked: viewer.bookmarked === true,
    muted: viewer.threadMuted === true,
    pinned: viewer.pinned === true,
    bluesky: {
      uri: view.uri,
      cid: view.cid,
      likeUri: viewer.like ?? null,
      repostUri: viewer.repost ?? null,
      replyRef: rec.reply ?? null,
      replyDisabled: viewer.replyDisabled === true,
      embeddingDisabled: viewer.embeddingDisabled === true,
      labels: mapLabels(view.labels),
      moderation: ctx.moderatePost(view),
      viewerOf: ctx.viewerOf,
    },
  }
}
