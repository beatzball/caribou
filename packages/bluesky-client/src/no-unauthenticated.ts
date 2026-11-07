import type { ComAtprotoLabelDefs } from '@atproto/api'

/**
 * True when the author asked that signed-out readers not see them (spec
 * 8.3): a `!no-unauthenticated` self-label that is not negated. Plain data
 * only, so the server-safe mappers can call it; `./moderation` re-exports it.
 */
export function isNoUnauthenticated(actor: { labels?: ComAtprotoLabelDefs.Label[] }): boolean {
  return (actor.labels ?? []).some((l) => l.val === '!no-unauthenticated' && !l.neg)
}
