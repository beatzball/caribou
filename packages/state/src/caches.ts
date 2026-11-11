import { batch, signal } from '@preact/signals-core'
import type { Account, FilterResult, Poll, Status } from '@beatzball/caribou-mastodon-client'
import { inflight } from './inflight.js'
import {
  forgetSlots, readerNow, settleViewer, withoutViewerState, PAGE_DATA, type CopySource,
} from './viewer-slots.js'

export { PAGE_DATA, readAs, readerNow, readSource, type CopySource } from './viewer-slots.js'

// Treat these signals as read-only. Mutating the Map in place
// (`statusCache.value.set(...)`) skips the signal-write and consumers
// won't re-render — always go through cacheStatus/cacheAccount/updateStatus.
export const statusCache  = signal<Map<string, Status>>(new Map())
export const accountCache = signal<Map<string, Account>>(new Map())

// Posts the reader deleted in this page session, by id. A list that keeps
// its own copies (a thread, notifications) hides a card whose post is here.
// The ids are the active account's server's, so an account change empties it.
export const deletedStatusIds = signal<ReadonlySet<string>>(new Set())

export function cacheAccount(acct: Account): void {
  const next = new Map(accountCache.value)
  next.set(acct.id, acct)
  accountCache.value = next
}

/**
 * What the copies of one post said, by post id: one record, whichever copy
 * brought it (the post alone, inside a boost, inside a quote). Reader-side
 * decisions read this record, never a search through cached copies. The
 * rules are the README's "Which copy wins" table.
 */
export interface PostRecord {
  /** Write order of the last copy fetched with a token; 0 when none was. */
  tokenAt: number
  /** That copy's `filtered`. Undefined until a copy with a token arrives. */
  filtered?: readonly FilterResult[]
  /** True once a copy carried `quote` (a Mastodon 4.5 server). */
  hasQuote: boolean
  /** The quote the post shows. */
  quote?: Status['quote']
}

export const postRecords = signal<ReadonlyMap<string, PostRecord>>(new Map())

// The order copies arrive in. A copy with a token is the reader's server's
// answer at that moment, so the last one to arrive is the newest.
let arrivals = 0

// A shallow quote (an id only: Mastodon embeds a quoted post's own quote so)
// that names the accepted post `had` carries in full says less than `had`.
function shallowOf(now: Status['quote'], had: Status['quote']): boolean {
  if (!now || now.state !== 'accepted' || 'quotedStatus' in now && now.quotedStatus) return false
  const full = had && had.state === 'accepted' && 'quotedStatus' in had ? had.quotedStatus : null
  return !!full && 'quotedStatusId' in now && now.quotedStatusId === full.id
}

function writeRecord(id: string, rec: PostRecord): void {
  const next = new Map(postRecords.peek())
  next.set(id, rec)
  postRecords.value = next
}

// Writes what one copy says into its post's record, and returns the record.
// A copy with a token (it has `filtered`: Mastodon sends one on every copy
// fetched with a token since 4.0, and quotes came in 4.5) always counts.
// A copy without one counts for the quote only while no copy with a token
// has arrived for this account: the quote state is the reader's (muted,
// blocked, unauthorized …), and page data must not undo it.
function noteCopy(copy: Status): PostRecord {
  const had = postRecords.peek().get(copy.id) ?? { tokenAt: 0, hasQuote: false }
  const withToken = Array.isArray(copy.filtered)
  let rec = had
  if (withToken) rec = { ...rec, tokenAt: ++arrivals, filtered: copy.filtered }
  if ('quote' in copy && (withToken || had.tokenAt === 0) && !shallowOf(copy.quote, had.quote)) {
    rec = { ...rec, hasQuote: true, quote: copy.quote }
  }
  if (rec !== had) writeRecord(copy.id, rec)
  return rec
}

/** The newest `filtered` known for a post, or undefined when none is known. */
export function readerFiltered(id: string): readonly FilterResult[] | undefined {
  return postRecords.value.get(id)?.filtered
}

/** The quote a post shows by the rules, null for none, undefined when no copy said. */
export function readerQuote(id: string): Status['quote'] | undefined {
  const rec = postRecords.value.get(id)
  return rec?.hasQuote ? rec.quote ?? null : undefined
}

// The post a quote shows (Mastodon 4.5), when the copy carries it. The
// quote inside a quoted post is shallow (an id only), so this goes one
// level deep.
function quotedIn(status: Status): Status | null {
  const q = status.quote
  return q && 'quotedStatus' in q && q.quotedStatus ? q.quotedStatus : null
}

function withQuoted(status: Status, quoted: Status): Status {
  return { ...status, quote: { ...status.quote!, quotedStatus: quoted } }
}

function store(status: Status): void {
  const next = new Map(statusCache.value)
  next.set(status.id, status)
  statusCache.value = next
  if (status.account) cacheAccount(status.account)
}

/**
 * Caches a copy just off the network, as it is, except that an older copy
 * never undoes a newer edit of the post (`protectEdits`), and its viewer
 * fields follow the slot rule (README, "Viewer state"). `source` says who
 * fetched it and when: take it with `readSource` before the request. With
 * none, the active reader fetched it just now.
 */
export function cacheStatus(status: Status, source: CopySource = readerNow()): void {
  batch(() => cacheOne(status, source))
}

// Gives a copy the quote its record says (`noteCopy`). When that is the
// copy's own quote, its quoted post is cached under its own id by the same
// rules (`put`), so an edit or a delete of it reaches every quote of it,
// and the record keeps the cached copy. A quote kept from the record is not
// cached again: its quoted post is an old copy, and its reader fields would
// undo newer ones.
function settleQuote(
  fresh: Status, put: (s: Status) => Status,
): Status {
  const rec = noteCopy(fresh)
  if (!rec.hasQuote) return fresh
  if (rec.quote !== fresh.quote) return { ...fresh, quote: rec.quote }
  const quoted = quotedIn(fresh)
  if (!quoted) return fresh
  const out = withQuoted(fresh, put(quoted))
  writeRecord(fresh.id, { ...postRecords.peek().get(fresh.id)!, quote: out.quote })
  return out
}

// A Bluesky Home reply's context posts (#275; README, "Bluesky Home
// context") are cached under their own ids by the same rules (`put`), as a
// quoted post is: a like, an edit or a delete of one reaches its card.
//
// A copy with no context (a thread's, a profile's, or this post as the
// parent of a newer reply) is the same post read elsewhere: it keeps the
// context the cached copy has, so the Home slice that shows it stays whole.
function settleContext(fresh: Status, put: (s: Status) => Status): Status {
  const ctx = fresh.bluesky?.replyContext
  if (!ctx) {
    const had = statusCache.peek().get(fresh.id)?.bluesky?.replyContext
    return had && fresh.bluesky ? { ...fresh, bluesky: { ...fresh.bluesky, replyContext: had } } : fresh
  }
  const replyContext = { ...ctx, root: ctx.root ? put(ctx.root) : null, parent: put(ctx.parent) }
  return { ...fresh, bluesky: { ...fresh.bluesky!, replyContext } }
}

function cacheOne(status: Status, source: CopySource): Status {
  const put = (s: Status) => cacheOne(s, source)
  const cache = statusCache.peek()
  let out = settleContext(settleQuote(protectVotes(protectEdits(status)), put), put)
  out = settleViewer(out, knownCopy(out.id, cache), source)
  if (out.reblog) {
    const inner = settleQuote(out.reblog, put)
    out = { ...out, reblog: settleViewer(inner, knownCopy(inner.id, cache), source) }
  }
  store(out)
  return out
}

/** True while the reader's vote on the poll of post `id` is out. */
function voting(id: string): boolean {
  return inflight.has(`vote:${id}`)
}

// The cached copy of post `id`: alone, or else inside a boost.
function knownCopy(id: string, cache: Map<string, Status>): Status | undefined {
  const own = cache.get(id)
  if (own) return own
  for (const s of cache.values()) if (s.reblog?.id === id) return s.reblog
  return undefined
}

// While the reader's vote is out, the cache shows it (the vote's own
// optimistic write). A copy fetched before the vote must not take it back.
function keepVoteInFlight(fresh: Status, cache: Map<string, Status>): Status {
  if (!fresh.poll || !voting(fresh.id)) return fresh
  const had = knownCopy(fresh.id, cache)?.poll
  return had && had.id === fresh.poll.id ? { ...fresh, poll: had } : fresh
}

function protectVotes(fresh: Status): Status {
  const cache = statusCache.peek()
  let out = keepVoteInFlight(fresh, cache)
  if (fresh.reblog) out = { ...out, reblog: keepVoteInFlight(fresh.reblog, cache) }
  return out
}

export function updateStatus(id: string, patch: Partial<Status>): void {
  const current = statusCache.value.get(id)
  // Silent no-op on cache miss. Currently dormant (nothing evicts), but if
  // eviction ever lands, callers must not assume the patch took.
  if (!current) return
  const next = new Map(statusCache.value)
  next.set(id, { ...current, ...patch })
  statusCache.value = next
}

/** The fields an edit of a post changes. */
export const EDIT_FIELDS = [
  'content', 'spoilerText', 'sensitive', 'mediaAttachments', 'card', 'poll', 'editedAt',
  'mentions', 'tags', 'emojis', 'language',
] as const

/** True when `known` carries a newer edit of the post than `fresh`. */
export function olderEdit(fresh: Status, known: Status | null | undefined): boolean {
  if (!known?.editedAt) return false
  return !fresh.editedAt || Date.parse(fresh.editedAt) < Date.parse(known.editedAt)
}

// The newest edit of a post the cache knows: its own copy, or the copy
// inside a boost of it, whichever was edited last.
function newestKnown(id: string, cache: Map<string, Status>): Status | undefined {
  let best = cache.get(id)
  for (const s of cache.values()) {
    if (s.reblog?.id === id && (!best || olderEdit(best, s.reblog))) best = s.reblog
  }
  return best
}

/** The newest edit of a post the cache knows, alone or inside a boost. */
export function newestKnownStatus(id: string): Status | undefined {
  return newestKnown(id, statusCache.peek())
}

function keepEdit(fresh: Status, known: Status | undefined): Status {
  if (!known || !olderEdit(fresh, known)) return fresh
  const out = { ...fresh } as Record<string, unknown>
  const had = known as unknown as Record<string, unknown>
  for (const key of EDIT_FIELDS) out[key] = had[key]
  return out as unknown as Status
}

// A copy can be older than one already cached: a fetch that left before
// the reader's edit and answers after it, page data from the server's
// upstream cache, or an earlier edit's late answer. The newest edit wins,
// for the post and for the post inside a boost; every other field comes
// from the copy at hand.
function protectEdits(fresh: Status): Status {
  const cache = statusCache.peek()
  let out = keepEdit(fresh, newestKnown(fresh.id, cache))
  if (fresh.reblog) out = { ...out, reblog: keepEdit(fresh.reblog, newestKnown(fresh.reblog.id, cache)) }
  return out
}

// A poll's `voted` and `ownVotes` are the reader's: a copy from the public
// API leaves them out. Such a copy keeps them from the cached one, and while
// the reader's vote is out the cached poll (the vote shown at once) stays.
// A public copy with fewer votes than the one the reader voted on is older
// (the server's upstream cache); its counts do not undo the vote.
function keepPollVote(
  fresh: Poll | null | undefined, had: Poll | null | undefined, voting: boolean,
): Poll | null | undefined {
  if (!fresh || !had || fresh.id !== had.id) return fresh
  if (voting) return had
  if (fresh.voted !== undefined || had.voted === undefined) return fresh
  if (had.voted && fresh.votesCount < had.votesCount) return { ...had, expired: fresh.expired || had.expired }
  return { ...fresh, voted: had.voted, ownVotes: had.ownVotes ?? null }
}

function keepReaderFields(fresh: Status, current: Status, source: CopySource): Status {
  const out = { ...settleViewer(fresh, current, source) } as Record<string, unknown>
  const had = current as unknown as Record<string, unknown>
  // Only a reader with a token gets `filtered`, so a copy that has it is
  // the reader's own and newer: a filter added or removed since shows.
  if (!Array.isArray(out.filtered) && 'filtered' in had) out.filtered = had.filtered
  out.poll = keepPollVote(fresh.poll, current.poll, voting(current.id))
  return out as unknown as Status
}

/**
 * Caches a fresh copy of a status. Content, edits and counts come from
 * `fresh`; the reader's own flags follow the slot rule (README, "Viewer
 * state"). `source` says who fetched it and when; with none it is page
 * data, which never changes cached viewer state. Returns the status as
 * now cached.
 */
export function mergeStatus(fresh: Status, source: CopySource = PAGE_DATA): Status {
  return batch(() => merge(fresh, source))
}

function merge(fresh: Status, source: CopySource): Status {
  const put = (s: Status) => merge(s, source)
  const cache = statusCache.peek()
  // A post cached only inside a boost is known too: its reader fields
  // (a vote cast through the boost) carry over to the post's own entry.
  const current = knownCopy(fresh.id, cache)
  // The same object again (a store seeded twice from one page): nothing new.
  if (current === fresh) return current
  fresh = protectEdits(fresh)
  // The quote first: its record reads the fresh copy's own `filtered`.
  let next = settleContext(settleQuote(fresh, put), put)
  next = current ? keepReaderFields(next, current, source) : settleViewer(next, undefined, source)
  if (fresh.reblog) {
    const inner = cache.get(fresh.reblog.id) ?? current?.reblog
    let reblog = settleQuote(fresh.reblog, put)
    reblog = inner ? keepReaderFields(reblog, inner, source) : settleViewer(reblog, undefined, source)
    next = { ...next, reblog }
    if (cache.has(fresh.reblog.id)) store(reblog)
  }
  store(next)
  return next
}

// What the reader has done to a post: the viewer fields (`viewer-slots.ts`),
// `filtered` and a poll's vote. With them gone the copy is as page data
// would have it.
function withoutReaderFields(status: Status): Status {
  const out = { ...withoutViewerState(status) } as Record<string, unknown>
  delete out.filtered
  if (status.poll) {
    const { voted: _voted, ownVotes: _own, ...poll } = status.poll
    out.poll = poll
  }
  if (status.reblog) out.reblog = withoutReaderFields(status.reblog)
  const ctx = status.bluesky?.replyContext
  if (ctx) {
    out.bluesky = {
      ...(out.bluesky as object),
      replyContext: { ...ctx, root: ctx.root ? withoutReaderFields(ctx.root) : null, parent: withoutReaderFields(ctx.parent) },
    }
  }
  const quoted = quotedIn(status)
  if (quoted) out.quote = { ...status.quote!, quotedStatus: withoutReaderFields(quoted) }
  return out as unknown as Status
}

/**
 * Drops the reader's own flags from every cached status, keeping the posts.
 * Run when the active account changes: the flags belong to the account that
 * fetched them, and a merge would otherwise hand them to the next one. A
 * list still on screen keeps its posts; the flags come back with the next
 * copy the new account fetches.
 */
// A quote of a deleted post says so, since the mark that hid it is about
// to go.
function withoutDeletedQuotes(s: Status, gone: ReadonlySet<string>): Status {
  const dead = (p: Status) => {
    const q = quotedIn(p)
    return q && gone.has(q.id) ? { ...p, quote: { state: 'deleted' as const, quotedStatus: null } } : p
  }
  const out = dead(s)
  return out.reblog ? { ...out, reblog: dead(out.reblog) } : out
}

export function forgetReaderFields(): void {
  const next = new Map<string, Status>()
  // The deleted marks go with the account; a copy of a deleted post that a
  // fetch brought back must go with them, or it would show again.
  const gone = deletedStatusIds.peek()
  for (const [id, s] of statusCache.peek()) {
    if (gone.has(id) || (s.reblog && gone.has(s.reblog.id))) continue
    next.set(id, withoutReaderFields(withoutDeletedQuotes(s, gone)))
  }
  forgetSlots()
  batch(() => {
    statusCache.value = next
    postRecords.value = new Map()
    deletedStatusIds.value = new Set()
  })
}
