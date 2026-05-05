import type { Status, Account } from '@beatzball/caribou-mastodon-client'
import { cachedFetch, TTL } from './upstream-cache.js'

export interface PublicFetchOpts { instance: string }

export async function fetchPublicTimeline(
  opts: PublicFetchOpts & { kind: 'local' | 'public'; maxId?: string },
): Promise<Status[]> {
  const params = new URLSearchParams()
  if (opts.kind === 'local') params.set('local', 'true')
  if (opts.maxId) params.set('max_id', opts.maxId)
  const url = `https://${opts.instance}/api/v1/timelines/public?${params}`
  return cachedFetch<Status[]>(url, TTL.PUBLIC_TIMELINE)
}

export async function fetchAccountByHandle(
  handle: string, opts: PublicFetchOpts,
): Promise<Account> {
  const url = `https://${opts.instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(handle)}`
  return cachedFetch<Account>(url, TTL.PROFILE)
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
  return cachedFetch<Status[]>(url, TTL.PROFILE_STATUSES)
}

export async function fetchStatus(statusId: string, opts: PublicFetchOpts): Promise<Status> {
  const url = `https://${opts.instance}/api/v1/statuses/${encodeURIComponent(statusId)}`
  return cachedFetch<Status>(url, TTL.STATUS)
}

export async function fetchThreadContext(
  statusId: string, opts: PublicFetchOpts,
): Promise<{ ancestors: Status[]; descendants: Status[] }> {
  const url = `https://${opts.instance}/api/v1/statuses/${encodeURIComponent(statusId)}/context`
  return cachedFetch<{ ancestors: Status[]; descendants: Status[] }>(url, TTL.THREAD_CONTEXT)
}
