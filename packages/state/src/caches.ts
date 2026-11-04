import { batch, signal } from '@preact/signals-core'
import type { mastodon } from 'masto'
import { isMutating } from './inflight.js'

// Treat these signals as read-only. Mutating the Map in place
// (`statusCache.value.set(...)`) skips the signal-write and consumers
// won't re-render — always go through cacheStatus/cacheAccount/updateStatus.
export const statusCache  = signal<Map<string, mastodon.v1.Status>>(new Map())
export const accountCache = signal<Map<string, mastodon.v1.Account>>(new Map())

// Posts the reader deleted in this page session, by id. A list that keeps
// its own copies (a thread, notifications) hides a card whose post is here.
// The ids are the active account's server's, so an account change empties it.
export const deletedStatusIds = signal<ReadonlySet<string>>(new Set())

export function cacheAccount(acct: mastodon.v1.Account): void {
  const next = new Map(accountCache.value)
  next.set(acct.id, acct)
  accountCache.value = next
}

// The newest `filtered` the reader's server sent for each post, by id,
// whichever copy it came in: the post alone, or inside a boost. A boost and
// the post it boosts are cached in two places, and either can be the newer
// one, so neither copy's own `filtered` decides; the last to arrive does.
// Only copies off the network write here: a merge that keeps an older
// cached value does not make it new again. Read it with `readerFiltered`.
export const filteredById = signal<ReadonlyMap<string, readonly mastodon.v1.FilterResult[]>>(new Map())

function noteFiltered(status: mastodon.v1.Status): void {
  const own = Array.isArray(status.filtered) ? status.filtered : null
  const inner = status.reblog && Array.isArray(status.reblog.filtered) ? status.reblog : null
  if (!own && !inner) return
  const next = new Map(filteredById.peek())
  if (own) next.set(status.id, own)
  if (inner) next.set(inner.id, inner.filtered!)
  filteredById.value = next
}

/** The newest `filtered` known for a post, or undefined when none is known. */
export function readerFiltered(id: string): readonly mastodon.v1.FilterResult[] | undefined {
  return filteredById.value.get(id)
}

// The post a quote shows (Mastodon 4.5), when the copy carries it. The
// quote inside a quoted post is shallow (an id only), so this goes one
// level deep.
function quotedIn(status: mastodon.v1.Status): mastodon.v1.Status | null {
  const q = status.quote
  return q && 'quotedStatus' in q && q.quotedStatus ? q.quotedStatus : null
}

function withQuoted(status: mastodon.v1.Status, quoted: mastodon.v1.Status): mastodon.v1.Status {
  return { ...status, quote: { ...status.quote!, quotedStatus: quoted } }
}

// A quoted post is cached under its own id too, so an edit or a delete of
// it reaches every quote of it. `put` caches it and returns the copy kept.
function cacheQuotes(
  status: mastodon.v1.Status, put: (s: mastodon.v1.Status) => mastodon.v1.Status,
): mastodon.v1.Status {
  let out = status
  const quoted = quotedIn(out)
  if (quoted) out = withQuoted(out, put(quoted))
  const inner = out.reblog ? quotedIn(out.reblog) : null
  if (out.reblog && inner) out = { ...out, reblog: withQuoted(out.reblog, put(inner)) }
  return out
}

function store(status: mastodon.v1.Status): void {
  const next = new Map(statusCache.value)
  next.set(status.id, status)
  statusCache.value = next
  if (status.account) cacheAccount(status.account)
}

/**
 * Caches a copy just off the network, as it is, except that an older copy
 * never undoes a newer edit of the post (`protectEdits`).
 */
export function cacheStatus(status: mastodon.v1.Status): void {
  batch(() => cacheOne(status))
}

// Which quote to keep when a copy of a post arrives over a cached one. Two
// copies say less than the cached one, and keep its quote:
// - A copy without a token (no `filtered`; Mastodon sends it on every copy
//   fetched with one since 4.0, and quotes came in 4.5) over the reader's
//   copy: the quote state is the reader's (muted, blocked, unauthorized …),
//   and the server's page data must not show what the reader's server hid.
//   An account change drops `filtered`, so the next copy is taken again.
// - A shallow quote (an id only, as Mastodon embeds a quoted post's own
//   quote) of the same accepted post the cached copy carries in full.
// Any other copy's quote is taken as it comes.
function keepQuote(fresh: mastodon.v1.Status, current: mastodon.v1.Status | undefined): mastodon.v1.Status {
  if (!current || !('quote' in current)) return fresh
  const tokenless = !Array.isArray(fresh.filtered) && Array.isArray(current.filtered)
  const now = fresh.quote
  const full = quotedIn(current)
  const shallowSame = !!now && now.state === 'accepted' && !quotedIn(fresh) && !!full
    && 'quotedStatusId' in now && now.quotedStatusId === full.id
  // A kept reader quote keeps the reader's `filtered` with it, so the next
  // copy without a token is still known as one (`cacheStatus` keeps no
  // other reader field).
  if (tokenless) return { ...fresh, quote: current.quote, filtered: current.filtered }
  return shallowSame ? { ...fresh, quote: current.quote } : fresh
}

function cacheOne(status: mastodon.v1.Status): mastodon.v1.Status {
  noteFiltered(status)
  const cache = statusCache.peek()
  let kept = keepQuote(protectEdits(status), cache.get(status.id))
  if (kept.reblog) kept = { ...kept, reblog: keepQuote(kept.reblog, cache.get(kept.reblog.id)) }
  const out = cacheQuotes(kept, cacheOne)
  store(out)
  return out
}

export function updateStatus(id: string, patch: Partial<mastodon.v1.Status>): void {
  const current = statusCache.value.get(id)
  // Silent no-op on cache miss. Currently dormant (nothing evicts), but if
  // eviction ever lands, callers must not assume the patch took.
  if (!current) return
  const next = new Map(statusCache.value)
  next.set(id, { ...current, ...patch })
  statusCache.value = next
}

// What the reader has done to a post. A copy from the public API (the page
// data the server fetches has no token) always says "not done", so a merge
// keeps these from the copy already cached.
const READER_FIELDS = ['favourited', 'reblogged', 'bookmarked', 'muted', 'pinned', 'filtered'] as const

const PAIRED_COUNTS = [['favourited', 'favouritesCount'], ['reblogged', 'reblogsCount']] as const

/** The fields an edit of a post changes. */
export const EDIT_FIELDS = [
  'content', 'spoilerText', 'sensitive', 'mediaAttachments', 'card', 'poll', 'editedAt',
  'mentions', 'tags', 'emojis', 'language',
] as const

/** True when `known` carries a newer edit of the post than `fresh`. */
export function olderEdit(fresh: mastodon.v1.Status, known: mastodon.v1.Status | null | undefined): boolean {
  if (!known?.editedAt) return false
  return !fresh.editedAt || Date.parse(fresh.editedAt) < Date.parse(known.editedAt)
}

// The newest edit of a post the cache knows: its own copy, or the copy
// inside a boost of it, whichever was edited last.
function newestKnown(id: string, cache: Map<string, mastodon.v1.Status>): mastodon.v1.Status | undefined {
  let best = cache.get(id)
  for (const s of cache.values()) {
    if (s.reblog?.id === id && (!best || olderEdit(best, s.reblog))) best = s.reblog
  }
  return best
}

/** The newest edit of a post the cache knows, alone or inside a boost. */
export function newestKnownStatus(id: string): mastodon.v1.Status | undefined {
  return newestKnown(id, statusCache.peek())
}

function keepEdit(fresh: mastodon.v1.Status, known: mastodon.v1.Status | undefined): mastodon.v1.Status {
  if (!known || !olderEdit(fresh, known)) return fresh
  const out = { ...fresh } as Record<string, unknown>
  const had = known as unknown as Record<string, unknown>
  for (const key of EDIT_FIELDS) out[key] = had[key]
  return out as unknown as mastodon.v1.Status
}

// A copy can be older than one already cached: a fetch that left before
// the reader's edit and answers after it, page data from the server's
// upstream cache, or an earlier edit's late answer. The newest edit wins,
// for the post and for the post inside a boost; every other field comes
// from the copy at hand.
function protectEdits(fresh: mastodon.v1.Status): mastodon.v1.Status {
  const cache = statusCache.peek()
  let out = keepEdit(fresh, newestKnown(fresh.id, cache))
  if (fresh.reblog) out = { ...out, reblog: keepEdit(fresh.reblog, newestKnown(fresh.reblog.id, cache)) }
  return out
}

function keepReaderFields(fresh: mastodon.v1.Status, current: mastodon.v1.Status): mastodon.v1.Status {
  const out = { ...fresh } as Record<string, unknown>
  const had = current as unknown as Record<string, unknown>
  for (const key of READER_FIELDS) {
    // Only a reader with a token gets `filtered`, so a copy that has it is
    // the reader's own and newer: a filter added or removed since shows.
    if (key === 'filtered' && Array.isArray(out.filtered)) continue
    if (key in had) out[key] = had[key]
  }
  for (const [flag, count] of PAIRED_COUNTS) {
    const was = (had[count] as number | undefined) ?? 0
    const now = (out[count] as number | undefined) ?? 0
    // While an action is out, the count holds its optimistic step, and a
    // failure undoes that step from whatever the count is then. And page
    // data passes through the server's upstream cache, so it can be older
    // than the count the reader's own action came back with.
    if (isMutating(current.id) || (had[flag] === true && now < was)) out[count] = had[count]
  }
  return out as unknown as mastodon.v1.Status
}

/**
 * Caches a fresh copy of a status, keeping the reader's own flags from the
 * copy already cached. Content, edits and counts come from `fresh`. Returns
 * the status as now cached.
 */
export function mergeStatus(fresh: mastodon.v1.Status): mastodon.v1.Status {
  return batch(() => merge(fresh))
}

function merge(fresh: mastodon.v1.Status): mastodon.v1.Status {
  const cache = statusCache.peek()
  const current = cache.get(fresh.id)
  // The same object again (a store seeded twice from one page): nothing new.
  if (current === fresh) return current
  noteFiltered(fresh)
  fresh = protectEdits(fresh)
  // `keepQuote` first: it reads the fresh copy's own `filtered`.
  let next = current ? keepReaderFields(keepQuote(fresh, current), current) : fresh
  if (fresh.reblog) {
    const inner = cache.get(fresh.reblog.id) ?? current?.reblog
    let reblog = inner ? keepReaderFields(keepQuote(fresh.reblog, inner), inner) : fresh.reblog
    reblog = cacheQuotes(reblog, merge)
    next = { ...next, reblog }
    if (cache.has(fresh.reblog.id)) store(reblog)
  }
  const quoted = quotedIn(next)
  if (quoted) next = withQuoted(next, merge(quoted))
  store(next)
  return next
}

function withoutReaderFields(status: mastodon.v1.Status): mastodon.v1.Status {
  const out = { ...status } as Record<string, unknown>
  for (const key of READER_FIELDS) delete out[key]
  if (status.reblog) out.reblog = withoutReaderFields(status.reblog)
  const quoted = quotedIn(status)
  if (quoted) out.quote = { ...status.quote!, quotedStatus: withoutReaderFields(quoted) }
  return out as unknown as mastodon.v1.Status
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
function withoutDeletedQuotes(s: mastodon.v1.Status, gone: ReadonlySet<string>): mastodon.v1.Status {
  const dead = (p: mastodon.v1.Status) => {
    const q = quotedIn(p)
    return q && gone.has(q.id) ? { ...p, quote: { state: 'deleted' as const, quotedStatus: null } } : p
  }
  const out = dead(s)
  return out.reblog ? { ...out, reblog: dead(out.reblog) } : out
}

export function forgetReaderFields(): void {
  const next = new Map<string, mastodon.v1.Status>()
  // The deleted marks go with the account; a copy of a deleted post that a
  // fetch brought back must go with them, or it would show again.
  const gone = deletedStatusIds.peek()
  for (const [id, s] of statusCache.peek()) {
    if (gone.has(id) || (s.reblog && gone.has(s.reblog.id))) continue
    next.set(id, withoutReaderFields(withoutDeletedQuotes(s, gone)))
  }
  batch(() => {
    statusCache.value = next
    filteredById.value = new Map()
    deletedStatusIds.value = new Set()
  })
}
