import { signal } from '@preact/signals-core'
import type { mastodon } from 'masto'

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
  if (!current) return
  const next = new Map(statusCache.value)
  next.set(id, { ...current, ...patch })
  statusCache.value = next
}
