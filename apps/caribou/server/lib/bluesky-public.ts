// Bluesky pages the server paints with no token (spec 8; app README,
// "Bluesky SSR"). Server only: it imports the atproto SDK (through the
// package's `./moderation` and `./syntax` doors), so a page loads it with a
// dynamic `import()` inside `pageData`, never statically.
//
// Every fetch goes through `xrpc()`, to `BLUESKY_PUBLIC_APPVIEW` only.

import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import {
  mapAccount, mapFeedEntry, mapPost, NO_UNAUTHENTICATED_NOTE, type MapContext,
} from '@beatzball/caribou-bluesky-client'
import {
  LOGGED_OUT_PREFS, labelDefsFromServices, moderate, type LabelDefs,
} from '@beatzball/caribou-bluesky-client/moderation'
import { isValidDid, isValidHandle, isValidRecordKey } from '@beatzball/caribou-bluesky-client/syntax'
import { cachedFetch, TTL } from './upstream-cache.js'
import { sanitizeAccount, sanitizeStatus } from './sanitize.js'

export { NO_UNAUTHENTICATED_NOTE }

export const DEFAULT_PUBLIC_APPVIEW = 'https://public.api.bsky.app'

/** True when the server paints Bluesky routes (the server side of the flag). */
export function blueskySsrEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BLUESKY_SSR === '1'
}

/** The AppView origin: `BLUESKY_PUBLIC_APPVIEW` when it is an http(s) URL, else the default. */
export function publicAppView(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.BLUESKY_PUBLIC_APPVIEW?.trim()
  if (raw) {
    try {
      const u = new URL(raw)
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin
    } catch { /* fall back */ }
  }
  return DEFAULT_PUBLIC_APPVIEW
}

/** True when `actor` is a well-formed DID or handle. Checked before any fetch. */
export function validActor(actor: string): boolean {
  return actor.startsWith('did:') ? isValidDid(actor) : isValidHandle(actor)
}

/** True when `rkey` is a well-formed record key. */
export function validRecordKey(rkey: string): boolean {
  return isValidRecordKey(rkey)
}

// The one place the server asks the AppView. #187 adds per-kind TTLs and
// the 429 fallback here.
async function xrpc<T>(method: string, params: Record<string, string | undefined>, ttl: number): Promise<T> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v)
  return cachedFetch<T>(`${publicAppView()}/xrpc/${method}?${q}`, ttl)
}

const BSKY_LABELERS = LOGGED_OUT_PREFS.labelers.map((l) => l.did)

/**
 * Bluesky's label definitions, for moderation with the logged-out defaults.
 * `null` when they cannot load: `moderate()` then covers every label it
 * cannot define (fail closed).
 */
export async function fetchLabelDefs(): Promise<LabelDefs | null> {
  try {
    const data = await xrpc<{ views: unknown[] }>('app.bsky.labeler.getServices', {
      dids: BSKY_LABELERS.join(','), detailed: 'true',
    }, TTL.BLUESKY_LABEL_DEFS)
    return labelDefsFromServices(data.views as Parameters<typeof labelDefsFromServices>[0])
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 8.3

const NO_UNAUTH = '!no-unauthenticated'

type Json = unknown

function isActor(v: Record<string, unknown>): boolean {
  return typeof v.did === 'string' && v.did.startsWith('did:') && typeof v.handle === 'string'
}

/**
 * A copy of an AppView answer in which every author object (anything with
 * a `did` and a `handle`) that has no `labels` array gets a
 * `!no-unauthenticated` self-label. An author whose labels were not read
 * counts as hidden (fail closed). The mappers and `mapEmbed` then hide it.
 */
export function failClosedLabels<T>(raw: T): T {
  const walk = (v: Json): Json => {
    if (Array.isArray(v)) return v.map(walk)
    if (typeof v !== 'object' || v === null) return v
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(o)) out[k] = walk(val)
    if (isActor(o) && !Array.isArray(o.labels)) {
      out.labels = [{ src: o.did, uri: `at://${String(o.did)}/app.bsky.actor.profile/self`, val: NO_UNAUTH, cts: '1970-01-01T00:00:00.000Z' }]
    }
    return out
  }
  return walk(raw) as T
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
      did, handleInvalid: false,
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

type PostView = Parameters<typeof mapPost>[0]
type FeedViewPost = Parameters<typeof mapFeedEntry>[0]
type ProfileView = Parameters<typeof mapAccount>[0]

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

function clean(s: Status): Status {
  return sanitizeStatus(signedOutStatus(s))
}

export type BlueskyTab = 'posts' | 'replies' | 'media'

const AUTHOR_FILTER = { posts: 'posts_no_replies', replies: 'posts_with_replies', media: 'posts_with_media' } as const

export type BlueskyProfileResult =
  | { kind: 'ok'; account: Account; statuses: Status[]; nextCursor: string | null }
  | { kind: 'hidden' }

/** A profile and its first page (or the page at `cursor`), signed out. */
export async function fetchBlueskyProfilePage(
  actor: string, opts: { tab: BlueskyTab; cursor?: string | undefined },
): Promise<BlueskyProfileResult> {
  const [profileRaw, defs] = await Promise.all([
    xrpc<ProfileView>('app.bsky.actor.getProfile', { actor }, TTL.BLUESKY),
    fetchLabelDefs(),
  ])
  const view = failClosedLabels(profileRaw)
  const mapped = mapAccount(view)
  // A hidden profile: its posts are not even fetched.
  if (asksHidden(mapped)) return { kind: 'hidden' }
  const account = sanitizeAccount({
    ...mapped,
    bluesky: { ...mapped.bluesky!, moderation: moderate({ kind: 'profile', view }, undefined, LOGGED_OUT_PREFS, defs) },
  })
  const feedRaw = await xrpc<{ feed: FeedViewPost[]; cursor?: string }>('app.bsky.feed.getAuthorFeed', {
    actor, filter: AUTHOR_FILTER[opts.tab], includePins: 'false', cursor: opts.cursor,
  }, TTL.BLUESKY)
  const feed = failClosedLabels(feedRaw)
  const ctx = context(defs)
  const statuses = each(feed.feed, (e) => clean(mapFeedEntry(e, ctx)))
  // An empty AppView page ends the list, even with a cursor (as in the client).
  const nextCursor = feed.feed.length > 0 ? feed.cursor ?? null : null
  return { kind: 'ok', account, statuses, nextCursor }
}

interface ThreadNode { $type?: string; post?: PostView; parent?: unknown; replies?: unknown[] }

function isThreadViewPost(v: unknown): v is ThreadNode & { post: PostView } {
  return typeof v === 'object' && v !== null
    && (v as ThreadNode).$type === 'app.bsky.feed.defs#threadViewPost'
}

export interface BlueskyThread {
  focused: Status
  ancestors: Status[]
  descendants: Status[]
}

/** A post and its thread, signed out. Throws when the post is not there. */
export async function fetchBlueskyThread(actor: string, rkey: string): Promise<BlueskyThread> {
  const uri = `at://${actor}/app.bsky.feed.post/${rkey}`
  const [raw, defs] = await Promise.all([
    xrpc<{ thread: unknown }>('app.bsky.feed.getPostThread', { uri }, TTL.BLUESKY),
    fetchLabelDefs(),
  ])
  const { thread } = failClosedLabels(raw)
  if (!isThreadViewPost(thread)) throw new Error('bluesky: post not found')
  const ctx = context(defs)
  const posts = (views: PostView[]) => each(views, (v) => clean(mapPost(v, ctx)))
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
