import { batch } from '@preact/signals-core'
import type { CaribouClient, EditStatusInput, Status } from '@beatzball/caribou-mastodon-client'
import { deletedStatusIds, mergeStatus, olderEdit, readSource, statusCache } from './caches.js'
import { ownerGeneration } from './keep-alive.js'


/** True when the reader deleted this post in this page session. */
export function isDeletedStatus(id: string): boolean {
  return deletedStatusIds.value.has(id)
}

/**
 * Saves an edit of the reader's own post, then writes the new copy to the
 * cache: the post itself and every boost of it, so each list that shows it
 * changes at once. A failure is rethrown for the editor to show. A result
 * that lands after the account changed writes nothing and resolves null.
 */
export async function editOwnStatus(
  client: CaribouClient, statusId: string, input: EditStatusInput,
): Promise<Status | null> {
  const generation = ownerGeneration()
  const source = readSource(client.userKey)
  const fresh = await client.editStatus(statusId, input)
  if (generation !== ownerGeneration()) return null
  // Always cached, even when only a boost held the post: a later stale
  // copy then has this one to lose against. The merge keeps the newest
  // edit, so a late answer to an earlier edit changes nothing.
  return batch(() => {
    const cached = mergeStatus(fresh, source)
    replaceInBoosts(cached)
    return cached
  })
}

// A boost holds its own copy of the post it boosts.
function replaceInBoosts(post: Status): void {
  const cache = statusCache.peek()
  let out: Map<string, Status> | null = null
  for (const [key, s] of cache) {
    if (s.reblog?.id !== post.id || olderEdit(post, s.reblog)) continue
    out ??= new Map(cache)
    out.set(key, { ...s, reblog: { ...s.reblog, ...post } })
  }
  if (out) statusCache.value = out
}

/** How a delete ended (README, "Bluesky delete and redraft"). */
export type DeleteOutcome =
  | { kind: 'deleted'; gone: Status; stale: boolean }
  | { kind: 'failed'; stale: boolean }
  /** Bluesky only: the delete had no clear answer and the check failed too. */
  | { kind: 'unknown'; stale: boolean }

export interface DeleteOptions {
  /** The toasts to show instead of the default ones. */
  messages?: { failed?: string; unknown?: string }
}

const FAILED = 'Could not delete this post. Try again.'
const UNKNOWN = 'Could not tell whether the post was deleted. Reload to check.'

/**
 * Deletes the reader's own post. It leaves every list at once: the post and
 * each boost of it go from the cache, and its id is marked deleted for the
 * lists that keep their own copies. When the delete fails, or its outcome
 * is unknown (Bluesky), everything comes back and a toast says which.
 * `stale`: the account changed meanwhile; then nothing is written to the
 * page and nothing is said, but the outcome is still answered.
 */
export async function deleteOwnStatusOutcome(
  client: CaribouClient, status: Status, opts: DeleteOptions = {},
): Promise<DeleteOutcome> {
  const post = status.reblog ?? status
  const id = post.id
  const generation = ownerGeneration()
  const removed = new Map<string, Status>()
  batch(() => {
    const cache = statusCache.peek()
    const next = new Map(cache)
    for (const [key, s] of cache) {
      if (key === id || s.reblog?.id === id) {
        removed.set(key, s)
        next.delete(key)
      }
    }
    statusCache.value = next
    deletedStatusIds.value = new Set([...deletedStatusIds.peek(), id])
  })
  try {
    // Bluesky's delete answers nothing; the post as the reader saw it is the answer.
    const gone = post.bluesky && client.blueskyDeletePost
      ? await client.blueskyDeletePost(post.bluesky.uri).then(() => post)
      : await client.deleteStatus(id)
    return { kind: 'deleted', gone, stale: generation !== ownerGeneration() }
  } catch (err) {
    // The client could not tell (bluesky-client README, "Delete").
    const kind = (err as { name?: unknown } | null)?.name === 'BlueskyDeleteUnknown' ? 'unknown' : 'failed'
    // The account changed: the change already emptied the marks, and the
    // posts are the old account's.
    if (generation !== ownerGeneration()) return { kind, stale: true }
    batch(() => {
      const next = new Map(statusCache.peek())
      // A copy that came back meanwhile (a poll) is newer; keep it.
      for (const [key, s] of removed) if (!next.has(key)) next.set(key, s)
      statusCache.value = next
      const marks = new Set(deletedStatusIds.peek())
      marks.delete(id)
      deletedStatusIds.value = marks
    })
    toast(kind === 'unknown' ? opts.messages?.unknown ?? UNKNOWN : opts.messages?.failed ?? FAILED)
    return { kind, stale: false }
  }
}

/**
 * `deleteOwnStatusOutcome` in the old shape: the deleted post as the server
 * sent it (its `text` is the source, for a Mastodon redraft), or null when
 * it was not deleted, the outcome is unknown, or the account changed.
 */
export async function deleteOwnStatus(client: CaribouClient, status: Status): Promise<Status | null> {
  const out = await deleteOwnStatusOutcome(client, status)
  return out.kind === 'deleted' && !out.stale ? out.gone : null
}

function toast(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'error', message } }))
}
