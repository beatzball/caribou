import type { ComAtprotoLabelDefs } from '@atproto/api'

/**
 * True when the author asked that signed-out readers not see them (spec
 * 8.3): a `!no-unauthenticated` self-label that is not negated. Plain data
 * only, so the server-safe mappers can call it; `./moderation` re-exports it.
 */
export function isNoUnauthenticated(actor: { labels?: ComAtprotoLabelDefs.Label[] }): boolean {
  return (actor.labels ?? []).some((l) => l.val === '!no-unauthenticated' && !l.neg)
}

/**
 * The signed-out allow-list (spec 8.3): true only when this author object
 * was read whole and its labels prove it may be shown. That is: an object
 * with a `did:` DID, a string handle, a `labels` array of objects, and no
 * `!no-unauthenticated` among them (a negated one does not count). Anything
 * else (no author, a partial one, labels missing, null or not an array)
 * is false: the content stays hidden.
 */
export function isProvenVisible(actor: unknown): boolean {
  if (typeof actor !== 'object' || actor === null || Array.isArray(actor)) return false
  const a = actor as Record<string, unknown>
  if (typeof a.did !== 'string' || !a.did.startsWith('did:') || typeof a.handle !== 'string') return false
  if (!Array.isArray(a.labels)) return false
  if (!a.labels.every((l) => typeof l === 'object' && l !== null && !Array.isArray(l))) return false
  return !isNoUnauthenticated(a as { labels: ComAtprotoLabelDefs.Label[] })
}
