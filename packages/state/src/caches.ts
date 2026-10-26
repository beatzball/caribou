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

export function cacheStatus(status: mastodon.v1.Status): void {
  const next = new Map(statusCache.value)
  next.set(status.id, status)
  statusCache.value = next
  if (status.account) cacheAccount(status.account)
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
  for (const key of READER_FIELDS) if (key in had) out[key] = had[key]
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
  let next = current ? keepReaderFields(fresh, current) : fresh
  if (fresh.reblog) {
    const inner = cache.get(fresh.reblog.id) ?? current?.reblog
    const reblog = inner ? keepReaderFields(fresh.reblog, inner) : fresh.reblog
    next = { ...next, reblog }
    if (cache.has(fresh.reblog.id)) cacheStatus(reblog)
  }
  cacheStatus(next)
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
  statusCache.value = next
}
