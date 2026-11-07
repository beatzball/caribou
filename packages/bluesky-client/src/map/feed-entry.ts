import type { AppBskyFeedDefs } from '@atproto/api'
import type { Status } from '@beatzball/caribou-mastodon-client'
import type { MapContext } from './context.js'
import { mapAccount } from './account.js'
import { mapPost } from './post.js'

const REASON_REPOST = 'app.bsky.feed.defs#reasonRepost'

/** The entry's repost reason, or null for a plain entry (or a pin, or an unknown reason). */
export function repostReason(entry: AppBskyFeedDefs.FeedViewPost): AppBskyFeedDefs.ReasonRepost | null {
  const reason = entry.reason
  return reason && reason.$type === REASON_REPOST ? (reason as AppBskyFeedDefs.ReasonRepost) : null
}

/**
 * A feed entry's identity (spec 6.3, seam 8). A plain post is its post URI.
 * A repost is `reason.uri`, or `repost:<by.did>:<post.uri>:<reason.indexedAt>`
 * when the AppView leaves `uri` out. The fallback never equals a post's id
 * or any record URI: it does not start with `at://`.
 */
export function feedEntryId(entry: AppBskyFeedDefs.FeedViewPost): string {
  const reason = repostReason(entry)
  if (!reason) return entry.post.uri
  return reason.uri ?? `repost:${reason.by.did}:${entry.post.uri}:${reason.indexedAt}`
}

/**
 * A feed entry → a `Status`. A repost becomes a wrapper whose `reblog` is the
 * post, as a Mastodon boost does (rules in the README).
 */
export function mapFeedEntry(entry: AppBskyFeedDefs.FeedViewPost, ctx: MapContext): Status {
  const post = mapPost(entry.post, ctx)
  const reason = repostReason(entry)
  if (!reason) return post
  const id = feedEntryId(entry)
  return {
    id,
    uri: reason.uri ?? id,
    url: post.url ?? null,
    createdAt: reason.indexedAt,
    editedAt: null,
    account: mapAccount(reason.by),
    content: '',
    visibility: 'public',
    sensitive: false,
    spoilerText: '',
    mediaAttachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    reblogsCount: 0,
    favouritesCount: 0,
    repliesCount: 0,
    quotesCount: 0,
    reblog: post,
    poll: null,
    card: null,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    bluesky: {
      uri: reason.uri ?? id,
      cid: reason.cid ?? '',
      likeUri: null,
      repostUri: null,
      replyRef: null,
      replyDisabled: false,
      embeddingDisabled: false,
      labels: [],
      moderation: post.bluesky!.moderation,
      viewerOf: ctx.viewerOf,
    },
  }
}
