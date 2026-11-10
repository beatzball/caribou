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

/**
 * How long a loaded copy is trusted with no request. An older copy is
 * answered at once and read again in the background.
 */
export const SAVED_FEEDS_FRESH_MS = 5 * 60_000

export interface SavedFeedsOpts {
  clientSource?: () => CaribouClient | null
  /** Read again even when a copy is cached (a Retry). Fails when the read fails. */
  force?: boolean
}

const inFlight = new Map<UserKey, Promise<SavedFeed[]>>()
const loadedAt = new Map<UserKey, number>()

/**
 * The active (or given) client's saved feeds. A fresh cached copy answers
 * with no request; an old one answers at once and is read again in the
 * background (a failure there keeps it). With no copy, or `force`, it reads
 * and throws when the read fails.
 */
export function loadSavedFeeds(opts: SavedFeedsOpts = {}): Promise<SavedFeed[]> {
  const client = (opts.clientSource ?? (() => activeClient.value))()
  // The Bluesky client is a proxy that answers every method name, so the
  // network says whether it has saved feeds, not `typeof`.
  if (!client || client.capabilities?.network !== 'bluesky' || !client.blueskySavedFeeds) return Promise.resolve([])
  const userKey = client.userKey
  const cached = savedFeedsCache.value.get(userKey)
  if (cached && !opts.force) {
    if (Date.now() - (loadedAt.get(userKey) ?? 0) >= SAVED_FEEDS_FRESH_MS) read(client).catch(() => {})
    return Promise.resolve(cached)
  }
  return read(client)
}

function read(client: CaribouClient): Promise<SavedFeed[]> {
  const userKey = client.userKey
  const running = inFlight.get(userKey)
  if (running) return running
  const load = (async () => {
    try {
      const feeds = await client.blueskySavedFeeds!()
      const next = new Map(savedFeedsCache.value)
      next.set(userKey, feeds)
      loadedAt.set(userKey, Date.now())
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
  loadedAt.clear()
  savedFeedsCache.value = new Map()
}
