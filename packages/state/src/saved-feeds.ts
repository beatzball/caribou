import { signal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, SavedFeed } from '@beatzball/caribou-mastodon-client'
import { activeClient, activeUserKey } from './users.js'

// A Bluesky reader's saved feeds (#194). Keyed by the account that read
// them, so one account never sees another's. Read only: nothing here writes
// the reader's prefs. Rules: README, "Stores".

/** Each Bluesky account's saved feeds, in the reader's order. */
export const savedFeedsCache = signal<Map<UserKey, SavedFeed[]>>(new Map())

export function savedFeedsFor(userKey: UserKey | null = activeUserKey.value): SavedFeed[] | undefined {
  return userKey ? savedFeedsCache.value.get(userKey) : undefined
}

export interface SavedFeedsOpts {
  clientSource?: () => CaribouClient | null
}

const inFlight = new Map<UserKey, Promise<SavedFeed[]>>()

/** Reads the active (or given) client's saved feeds into the cache. */
export function loadSavedFeeds(opts: SavedFeedsOpts = {}): Promise<SavedFeed[]> {
  const client = (opts.clientSource ?? (() => activeClient.value))()
  // The Bluesky client is a proxy that answers every method name, so the
  // network says whether it has saved feeds, not `typeof`.
  if (!client || client.capabilities?.network !== 'bluesky' || !client.blueskySavedFeeds) return Promise.resolve([])
  const userKey = client.userKey
  const running = inFlight.get(userKey)
  if (running) return running
  const load = (async () => {
    try {
      const feeds = await client.blueskySavedFeeds!()
      const next = new Map(savedFeedsCache.value)
      next.set(userKey, feeds)
      savedFeedsCache.value = next
      return feeds
    } finally {
      inFlight.delete(userKey)
    }
  })()
  inFlight.set(userKey, load)
  return load
}

/** @internal */
export function _resetSavedFeedsForTests(): void {
  inFlight.clear()
  savedFeedsCache.value = new Map()
}
