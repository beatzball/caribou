import type { AppBskyFeedDefs } from '@atproto/api'
import { repostReason } from './map/feed-entry.js'
import { postRecord } from './map/post.js'

// Home (Following) as bsky.app shows it (#275). Rules in the README, "Home:
// feed prefs and reply context". Pure and server-safe: no SDK at runtime.

/**
 * The reader's `feedViewPref` for `home`, the parts bsky.app still reads.
 * `hideRepliesByUnfollowed` and `hideRepliesByLikeCount` are legacy: bsky.app
 * ignores them, and so does Caribou (README, "Home", rule 1).
 */
export interface HomeFeedPrefs {
  hideReplies: boolean
  hideReposts: boolean
  hideQuotePosts: boolean
}

export const HOME_FEED_DEFAULTS: Readonly<HomeFeedPrefs> = Object.freeze({
  hideReplies: false,
  hideReposts: false,
  hideQuotePosts: false,
})

const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt)

/**
 * Rule 1: the home prefs out of `getPreferences`' answer. Anything missing
 * or of the wrong type is the default.
 */
export function homeFeedPrefs(prefs: unknown): HomeFeedPrefs {
  const home = (prefs as { feedViewPrefs?: Record<string, unknown> } | null | undefined)?.feedViewPrefs?.home as
    Partial<Record<keyof HomeFeedPrefs, unknown>> | undefined
  const d = HOME_FEED_DEFAULTS
  if (!home || typeof home !== 'object') return { ...d }
  return {
    hideReplies: bool(home.hideReplies, d.hideReplies),
    hideReposts: bool(home.hideReposts, d.hideReposts),
    hideQuotePosts: bool(home.hideQuotePosts, d.hideQuotePosts),
  }
}

type Author = { did: string; viewer?: { following?: string } }

const POST_VIEW = 'app.bsky.feed.defs#postView'

/** The reply ref's root or parent, when it is a post the reader can see. */
export function asPostView(v: unknown): AppBskyFeedDefs.PostView | null {
  if (typeof v !== 'object' || v === null) return null
  const p = v as { $type?: unknown; uri?: unknown; author?: unknown }
  // The AppView types every union member; a view without `$type` that has
  // an author and a URI is a post view too (fixtures, older answers).
  if (p.$type !== undefined && p.$type !== POST_VIEW) return null
  return typeof p.uri === 'string' && typeof p.author === 'object' && p.author !== null
    ? (v as AppBskyFeedDefs.PostView)
    : null
}

const QUOTED = new Set([
  'app.bsky.embed.record#viewRecord',
  'app.bsky.embed.record#viewNotFound',
  'app.bsky.embed.record#viewBlocked',
  'app.bsky.embed.record#viewDetached',
])

/** Rule 4: the post embeds a post (shown or not there any more). */
export function isQuotePost(post: AppBskyFeedDefs.PostView): boolean {
  const embed = post.embed as { $type?: string; record?: { $type?: string; record?: { $type?: string } } } | undefined
  if (!embed) return false
  if (embed.$type === 'app.bsky.embed.record#view') return QUOTED.has(embed.record?.$type ?? '')
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view') return QUOTED.has(embed.record?.record?.$type ?? '')
  return false
}

/**
 * Rules 2 to 5: whether a Home entry shows. `reader` is the reader's DID.
 */
export function showInHome(entry: AppBskyFeedDefs.FeedViewPost, prefs: HomeFeedPrefs, reader: string): boolean {
  const mine = (a: Author | undefined) => !!a && a.did === reader
  const followed = (a: Author | undefined) => !!a && (a.did === reader || !!a.viewer?.following)
  const post = entry.post
  // Rule 2: a thread the reader muted never shows, their own included.
  if (post.viewer?.threadMuted === true) return false
  const repost = repostReason(entry)
  // Rule 3 and 4: a repost by the reader always shows.
  if (repost) {
    if (mine(repost.by)) return true
    // Rule 6.1: a reposted reply the AppView sent without `reply` is an orphan.
    if (postRecord(post.record).reply && !entry.reply) return false
    return !prefs.hideReposts && !(prefs.hideQuotePosts && isQuotePost(post))
  }
  // Rule 3: the reader's own post or reply.
  if (mine(post.author)) return true
  const rec = postRecord(post.record)
  if (!rec.reply) return !(prefs.hideQuotePosts && isQuotePost(post))
  // Rule 5.1: an orphan never shows.
  const parent = asPostView(entry.reply?.parent)
  const root = asPostView(entry.reply?.root)
  if (!parent || !root) return false
  // Rule 3: a reply to the reader.
  if (mine(parent.author)) return true
  if (prefs.hideQuotePosts && isQuotePost(post)) return false
  const author = post.author.did
  const grand = entry.reply?.grandparentAuthor as Author | undefined
  const chain = [parent.author, grand, root.author].filter((a): a is Author => !!a)
  const selfThread = chain.every((a) => a.did === author)
  // Rule 5.2: with replies hidden, only a self-thread shows.
  if (prefs.hideReplies) return selfThread
  // Rule 5.3: followed author, and a self-thread or a followed author on the way.
  if (!followed(post.author)) return false
  return selfThread || chain.some((a) => a.did !== author && followed(a))
}

/**
 * Rule 6: the posts a shown reply is drawn under, as views, or null when it
 * has none (not a reply, a repost, or no parent post view).
 */
export function replyContextViews(entry: AppBskyFeedDefs.FeedViewPost): {
  root: AppBskyFeedDefs.PostView | null
  parent: AppBskyFeedDefs.PostView
  gap: boolean
} | null {
  if (repostReason(entry) || !postRecord(entry.post.record).reply) return null
  const parent = asPostView(entry.reply?.parent)
  if (!parent) return null
  const rootView = asPostView(entry.reply?.root)
  const root = rootView && rootView.uri !== parent.uri ? rootView : null
  const parentOfParent = postRecord(parent.record).reply?.parent.uri ?? null
  // Skipped posts: the parent is a reply, and what it answers is not shown.
  const gap = parentOfParent !== null && parentOfParent !== root?.uri
  return { root, parent, gap }
}
