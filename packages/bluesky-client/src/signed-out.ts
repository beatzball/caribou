// Signed-out pages (spec 8.2, 8.3): a profile and its first page, or a
// thread, read from the public AppView with no token, guarded and mapped.
// One copy for both callers: the server's SSR (`apps/caribou/server/lib/
// bluesky-public.ts`) and the browser's fallback when the server was rate
// limited (#187). Each caller brings its own fetch and its own HTML cleaner.
//
// It runs moderation, so it imports the SDK through `./moderation.ts`, which
// re-exports it: the server imports it; the browser loads it lazily, in the
// `bsky` chunk. Rules: README, "Signed-out pages".

import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import { mapAccount } from './map/account.js'
import type { MapContext } from './map/context.js'
import { mapFeedEntry } from './map/feed-entry.js'
import { mapPost } from './map/post.js'
import { isProvenVisible } from './no-unauthenticated.js'
import { LOGGED_OUT_PREFS, labelDefsFromServices, moderate, type LabelDefs } from './moderation.js'

/** Which AppView call: the caller picks a cache TTL by it. */
export type SignedOutCall = 'profile' | 'authorFeed' | 'thread' | 'labelDefs'

export interface SignedOutSource {
  /** One XRPC call to the public AppView. Throws on any failure. */
  xrpc<T>(method: string, params: Record<string, string | undefined>, call: SignedOutCall): Promise<T>
  /** Cleans the HTML of a mapped post and account (the caller's DOMPurify). */
  clean: { status(s: Status): Status; account(a: Account): Account }
}

// ---------------------------------------------------------------- 8.3
//
// The allow-list: an author's content shows signed out only when the code
// has seen that author whole, with a `labels` array and no
// `!no-unauthenticated` (`isProvenVisible`). Each author slot of an AppView
// answer is checked by name before mapping. An author that is not proven
// visible is replaced by a hidden marker: its DID (or the one in the
// record's URI), `handle.invalid`, and the label. Nothing else of it is
// kept. Quoted authors and record card creators are checked the same way
// inside `mapEmbed` (`ctx.viewerOf` is null here).

const NO_UNAUTH = '!no-unauthenticated'

function didOfUri(uri: unknown): string {
  const m = typeof uri === 'string' ? /^at:\/\/(did:[^/]+)\//.exec(uri) : null
  return m ? m[1]! : 'did:invalid:unknown'
}

function hiddenActor(actor: unknown, fallbackDid: string) {
  const own = typeof actor === 'object' && actor !== null ? (actor as { did?: unknown }).did : undefined
  const did = typeof own === 'string' && own.startsWith('did:') ? own : fallbackDid
  return {
    did, handle: 'handle.invalid',
    labels: [{ src: did, uri: `at://${did}/app.bsky.actor.profile/self`, val: NO_UNAUTH, cts: '1970-01-01T00:00:00.000Z' }],
  }
}

/** The author as it came when proven visible, else the hidden marker. */
export function guardActor<T>(actor: T, fallbackDid: string): T {
  return (isProvenVisible(actor) ? actor : hiddenActor(actor, fallbackDid)) as T
}

type Obj = Record<string, unknown>

function guardPost<T>(post: T): T {
  if (typeof post !== 'object' || post === null) return post
  const p = post as Obj
  return { ...p, author: guardActor(p.author, didOfUri(p.uri)) } as T
}

/** A feed entry with its author and reposter checked. Its `reply` is dropped: it is never shown. */
export function guardFeedEntry<T>(entry: T): T {
  const e = entry as Obj
  const out: Obj = { ...e, post: guardPost(e.post) }
  delete out.reply
  const reason = e.reason as Obj | undefined
  if (reason && typeof reason === 'object' && reason.$type === 'app.bsky.feed.defs#reasonRepost') {
    out.reason = { ...reason, by: guardActor(reason.by, didOfUri(reason.uri)) }
  }
  return out as T
}

type PostView = Parameters<typeof mapPost>[0]
interface ThreadNode { $type?: string; post?: PostView; parent?: unknown; replies?: unknown[] }

function isThreadViewPost(v: unknown): v is ThreadNode & { post: PostView } {
  return typeof v === 'object' && v !== null
    && (v as ThreadNode).$type === 'app.bsky.feed.defs#threadViewPost'
}

/** A thread with every post's author checked, parents and replies included. */
export function guardThreadNode<T>(node: T): T {
  if (!isThreadViewPost(node)) return node
  const n = node as unknown as Obj
  const out: Obj = { ...n, post: guardPost(n.post) }
  if (n.parent !== undefined) out.parent = guardThreadNode(n.parent)
  if (Array.isArray(n.replies)) out.replies = n.replies.map(guardThreadNode)
  return out as T
}

/** True when the mapped account self-labels `!no-unauthenticated` (not negated). */
export function asksHidden(account: Account): boolean {
  return (account.bluesky?.labels ?? []).some((l) => l.val === NO_UNAUTH && !l.neg)
}

/**
 * What is left of a hidden account: its DID and the label that hides it.
 * No name, handle, avatar, banner, bio or link.
 */
export function hiddenAccount(a: Account): Account {
  const did = a.bluesky?.did ?? a.id
  return {
    id: did, username: '', acct: '', url: '', displayName: '', note: '',
    avatar: '', avatarStatic: '', header: '', headerStatic: '',
    locked: false, fields: [], emojis: [], bot: false, group: false,
    createdAt: '', lastStatusAt: null, statusesCount: 0, followersCount: 0, followingCount: 0, roles: [],
    bluesky: {
      // `handleInvalid`: every path built from it is a DID path, never `/@`.
      did, handleInvalid: true,
      labels: (a.bluesky?.labels ?? []).filter((l) => l.val === NO_UNAUTH && !l.neg),
    },
  }
}

// A hidden feed item or thread post: its id, time and reply link, and the
// hidden author, so the card renders the notice. Nothing else.
function hiddenStatus(s: Status, who: Account): Status {
  return {
    id: s.id, uri: s.uri, createdAt: s.createdAt, editedAt: null,
    account: hiddenAccount(who),
    content: '', visibility: 'public', sensitive: false, spoilerText: '',
    mediaAttachments: [], mentions: [], tags: [], emojis: [],
    reblogsCount: 0, favouritesCount: 0, repliesCount: 0, quotesCount: 0,
    url: null, inReplyToId: s.inReplyToId ?? null, inReplyToAccountId: s.inReplyToAccountId ?? null,
    reblog: null, poll: null, card: null, quote: null, language: null,
    favourited: false, reblogged: false, bookmarked: false,
    bluesky: {
      uri: s.bluesky?.uri ?? s.uri, cid: s.bluesky?.cid ?? '',
      likeUri: null, repostUri: null, replyRef: null, replyDisabled: false, embeddingDisabled: false,
      labels: [], moderation: (s.reblog ?? s).bluesky!.moderation, viewerOf: null, recordCard: null,
    },
  }
}

const HIDDEN_QUOTE = { state: 'unauthorized', quotedStatus: null, bluesky: { hidden: 'no-unauthenticated' } } as const

function withoutHiddenQuote(s: Status): Status {
  const q = s.quote
  if (q && 'quotedStatus' in q && q.quotedStatus && asksHidden(q.quotedStatus.account)) {
    return { ...s, quote: { ...HIDDEN_QUOTE } }
  }
  return s
}

/**
 * The signed-out copy of one mapped item (spec 8.3): hidden whole when its
 * author or its reposter is hidden; a hidden quoted post becomes the quote
 * notice. `mapEmbed` already hides those; this checks again.
 */
export function signedOutStatus(s: Status): Status {
  const inner = s.reblog ?? null
  if (asksHidden(s.account)) return hiddenStatus(s, s.account)
  if (inner && asksHidden(inner.account)) return hiddenStatus(s, inner.account)
  const out = withoutHiddenQuote(s)
  return inner ? { ...out, reblog: withoutHiddenQuote(inner) } : out
}

// ---------------------------------------------------------------- pages

type FeedViewPost = Parameters<typeof mapFeedEntry>[0]
type ProfileView = Parameters<typeof mapAccount>[0]

/**
 * Bluesky's label definitions, for moderation with the logged-out defaults.
 * `null` when they cannot load: `moderate()` then covers every label it
 * cannot define (fail closed).
 */
export async function signedOutLabelDefs(src: SignedOutSource): Promise<LabelDefs | null> {
  try {
    const data = await src.xrpc<{ views: unknown[] }>('app.bsky.labeler.getServices', {
      dids: LOGGED_OUT_PREFS.labelers.map((l) => l.did).join(','), detailed: 'true',
    }, 'labelDefs')
    return labelDefsFromServices(data.views as Parameters<typeof labelDefsFromServices>[0])
  } catch {
    return null
  }
}

function context(defs: LabelDefs | null): MapContext {
  return {
    viewerOf: null,
    moderatePost: (view) => moderate({ kind: 'post', view }, undefined, LOGGED_OUT_PREFS, defs),
  }
}

// One bad post never fails a page (as in the client).
function each<T>(items: readonly T[], map: (item: T) => Status): Status[] {
  return items.flatMap((item) => {
    try {
      return [map(item)]
    } catch {
      return []
    }
  })
}

export type SignedOutTab = 'posts' | 'replies' | 'media'

const AUTHOR_FILTER = { posts: 'posts_no_replies', replies: 'posts_with_replies', media: 'posts_with_media' } as const

export type SignedOutProfile =
  | { kind: 'ok'; account: Account; statuses: Status[]; nextCursor: string | null }
  | { kind: 'hidden' }

/** A profile and its first page (or the page at `cursor`), signed out. */
export async function signedOutProfilePage(
  src: SignedOutSource, actor: string, opts: { tab: SignedOutTab; cursor?: string | undefined },
): Promise<SignedOutProfile> {
  const [view, defs] = await Promise.all([
    src.xrpc<ProfileView>('app.bsky.actor.getProfile', { actor }, 'profile'),
    signedOutLabelDefs(src),
  ])
  // A hidden profile, or one whose labels were not read: its posts are
  // not even fetched.
  if (!isProvenVisible(view)) return { kind: 'hidden' }
  const mapped = mapAccount(view)
  const account = src.clean.account({
    ...mapped,
    bluesky: { ...mapped.bluesky!, moderation: moderate({ kind: 'profile', view }, undefined, LOGGED_OUT_PREFS, defs) },
  })
  const feed = await src.xrpc<{ feed: FeedViewPost[]; cursor?: string }>('app.bsky.feed.getAuthorFeed', {
    actor, filter: AUTHOR_FILTER[opts.tab], includePins: 'false', cursor: opts.cursor,
  }, 'authorFeed')
  const ctx = context(defs)
  const statuses = each(feed.feed, (e) => src.clean.status(signedOutStatus(mapFeedEntry(guardFeedEntry(e), ctx))))
  // An empty AppView page ends the list, even with a cursor (as in the client).
  const nextCursor = feed.feed.length > 0 ? feed.cursor ?? null : null
  return { kind: 'ok', account, statuses, nextCursor }
}

export interface SignedOutThread {
  focused: Status
  ancestors: Status[]
  descendants: Status[]
}

/** A post and its thread, signed out. Throws when the post is not there. */
export async function signedOutThread(src: SignedOutSource, actor: string, rkey: string): Promise<SignedOutThread> {
  const uri = `at://${actor}/app.bsky.feed.post/${rkey}`
  const [raw, defs] = await Promise.all([
    src.xrpc<{ thread: unknown }>('app.bsky.feed.getPostThread', { uri }, 'thread'),
    signedOutLabelDefs(src),
  ])
  const thread = guardThreadNode(raw.thread)
  if (!isThreadViewPost(thread)) throw new Error('bluesky: post not found')
  const ctx = context(defs)
  const posts = (views: PostView[]) => each(views, (v) => src.clean.status(signedOutStatus(mapPost(v, ctx))))
  const focused = posts([thread.post])[0]
  if (!focused) throw new Error('bluesky: post not found')
  // Ancestors oldest first; replies depth first (as in the client).
  const ancestors: Status[] = []
  for (let p = thread.parent; isThreadViewPost(p); p = p.parent) ancestors.unshift(...posts([p.post]))
  const descendants: Status[] = []
  const walk = (node: ThreadNode) => {
    for (const reply of node.replies ?? []) {
      if (!isThreadViewPost(reply)) continue
      descendants.push(...posts([reply.post]))
      walk(reply)
    }
  }
  walk(thread)
  return { focused, ancestors, descendants }
}
