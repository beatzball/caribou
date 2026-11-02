import { batch, signal } from '@preact/signals-core'
import type { mastodon } from 'masto'
import { isMutating } from './inflight.js'

// Treat these signals as read-only. Mutating the Map in place
// (`statusCache.value.set(...)`) skips the signal-write and consumers
// won't re-render — always go through cacheStatus/cacheAccount/updateStatus.
export const statusCache  = signal<Map<string, mastodon.v1.Status>>(new Map())
export const accountCache = signal<Map<string, mastodon.v1.Account>>(new Map())

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

function store(status: mastodon.v1.Status): void {
  const next = new Map(statusCache.value)
  next.set(status.id, status)
  statusCache.value = next
  if (status.account) cacheAccount(status.account)
}

/** Caches a copy just off the network, as it is. */
export function cacheStatus(status: mastodon.v1.Status): void {
  batch(() => {
    noteFiltered(status)
    store(status)
  })
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
  let next = current ? keepReaderFields(fresh, current) : fresh
  if (fresh.reblog) {
    const inner = cache.get(fresh.reblog.id) ?? current?.reblog
    const reblog = inner ? keepReaderFields(fresh.reblog, inner) : fresh.reblog
    next = { ...next, reblog }
    if (cache.has(fresh.reblog.id)) store(reblog)
  }
  store(next)
  return next
}

function withoutReaderFields(status: mastodon.v1.Status): mastodon.v1.Status {
  const out = { ...status } as Record<string, unknown>
  for (const key of READER_FIELDS) delete out[key]
  if (status.reblog) out.reblog = withoutReaderFields(status.reblog)
  return out as unknown as mastodon.v1.Status
}

/**
 * Drops the reader's own flags from every cached status, keeping the posts.
 * Run when the active account changes: the flags belong to the account that
 * fetched them, and a merge would otherwise hand them to the next one. A
 * list still on screen keeps its posts; the flags come back with the next
 * copy the new account fetches.
 */
export function forgetReaderFields(): void {
  const next = new Map<string, mastodon.v1.Status>()
  for (const [id, s] of statusCache.peek()) next.set(id, withoutReaderFields(s))
  batch(() => {
    statusCache.value = next
    filteredById.value = new Map()
  })
}
