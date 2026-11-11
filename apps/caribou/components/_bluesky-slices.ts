import type { Status } from '@beatzball/caribou-mastodon-client'

// Bluesky Home shows one slice per thread (#275; README, "Bluesky views",
// "Home shows threads as slices", rule 4). Pure: no network, no DOM.

/**
 * The thread an entry belongs to. A Bluesky reply is its root's URI; a
 * plain Bluesky post is its own. A repost, and anything not Bluesky, is its
 * own entry and never shares a thread.
 */
export function threadKey(s: Status): string {
  if (s.reblog || !s.bluesky) return `entry:${s.id}`
  return `thread:${s.bluesky.replyRef?.root.uri ?? s.bluesky.uri}`
}

/**
 * The entries to draw: the first (newest, in feed order) of each thread.
 * The same array when nothing is dropped, so a quiet poll stays quiet.
 */
export function oneSlicePerThread(statuses: readonly Status[]): readonly Status[] {
  const seen = new Set<string>()
  let out: Status[] | null = null
  statuses.forEach((s, i) => {
    const key = threadKey(s)
    if (!seen.has(key)) {
      seen.add(key)
      out?.push(s)
      return
    }
    out ??= statuses.slice(0, i)
  })
  return out ?? statuses
}
