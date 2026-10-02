import type { Status, Account } from '@beatzball/caribou-mastodon-client'
import { cachedFetch, TTL } from './upstream-cache.js'
import { camelizeKeysDeep } from './case-transform.js'

export interface PublicFetchOpts { instance: string }

// Mastodon's REST API replies in snake_case but our components consume the
// masto.js camelCase shape (`createdAt`, `displayName`, `avatarStatic`, …).
// Convert at the boundary so the cache and every caller see the camelCase
// shape — otherwise `display.createdAt` reads `undefined` and the timestamp
// link renders as "undefined NaN, NaN".
async function fetchCamel<T>(url: string, ttl: number): Promise<T> {
  const raw = await cachedFetch<unknown>(url, ttl)
  return camelizeKeysDeep<T>(raw)
}

export async function fetchPublicTimeline(
  opts: PublicFetchOpts & { kind: 'local' | 'public'; maxId?: string },
): Promise<Status[]> {
  const params = new URLSearchParams()
  if (opts.kind === 'local') params.set('local', 'true')
  if (opts.maxId) params.set('max_id', opts.maxId)
  const url = `https://${opts.instance}/api/v1/timelines/public?${params}`
  return fetchCamel<Status[]>(url, TTL.PUBLIC_TIMELINE)
}

export async function fetchAccountByHandle(
  handle: string, opts: PublicFetchOpts,
): Promise<Account> {
  const url = `https://${opts.instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(handle)}`
  return fetchCamel<Account>(url, TTL.PROFILE)
}

export async function fetchAccountStatuses(
  accountId: string,
  opts: PublicFetchOpts & { tab: 'posts' | 'replies' | 'media'; maxId?: string },
): Promise<Status[]> {
  const params = new URLSearchParams()
  if (opts.tab === 'posts')  params.set('exclude_replies', 'true')
  if (opts.tab === 'media')  params.set('only_media', 'true')
  if (opts.maxId) params.set('max_id', opts.maxId)
  const url = `https://${opts.instance}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?${params}`
  return fetchCamel<Status[]>(url, TTL.PROFILE_STATUSES)
}

export async function fetchStatus(statusId: string, opts: PublicFetchOpts): Promise<Status> {
  const url = `https://${opts.instance}/api/v1/statuses/${encodeURIComponent(statusId)}`
  return fetchCamel<Status>(url, TTL.STATUS)
}

export async function fetchThreadContext(
  statusId: string, opts: PublicFetchOpts,
): Promise<{ ancestors: Status[]; descendants: Status[] }> {
  const url = `https://${opts.instance}/api/v1/statuses/${encodeURIComponent(statusId)}/context`
  return fetchCamel<{ ancestors: Status[]; descendants: Status[] }>(url, TTL.THREAD_CONTEXT)
}
