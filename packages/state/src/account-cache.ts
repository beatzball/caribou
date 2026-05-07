import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { accountCache, cacheAccount } from './caches.js'

export interface AccountCache {
  lookup(handle: string): Promise<mastodon.v1.Account | null>
}

export function createAccountCache(
  clientSource: () => CaribouClient | null,
): AccountCache {
  // Two layers of memoization. handleToId maps `user@host` → account.id so
  // we can hit the shared accountCache signal (keyed by id, populated by
  // every code path that fetches accounts). inflight prevents the
  // thundering-herd case where multiple callers ask for the same handle
  // before the first request lands.
  const handleToId = new Map<string, string>()
  const inflight = new Map<string, Promise<mastodon.v1.Account | null>>()

  return {
    async lookup(handle) {
      const knownId = handleToId.get(handle)
      if (knownId) return accountCache.value.get(knownId) ?? null

      const pending = inflight.get(handle)
      if (pending) return pending

      const client = clientSource()
      if (!client) return null

      const promise = (async () => {
        try {
          const account = await client.lookupAccount(handle)
          cacheAccount(account)
          handleToId.set(handle, account.id)
          return account
        } finally {
          inflight.delete(handle)
        }
      })()
      inflight.set(handle, promise)
      return promise
    },
  }
}
