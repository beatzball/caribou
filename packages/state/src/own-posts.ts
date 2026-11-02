import { batch } from '@preact/signals-core'
import type { CaribouClient, EditStatusInput } from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'
import { deletedStatusIds, mergeStatus, olderEdit, statusCache } from './caches.js'
import { ownerGeneration } from './keep-alive.js'

type Status = mastodon.v1.Status

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
  const fresh = await client.editStatus(statusId, input)
  if (generation !== ownerGeneration()) return null
  // Always cached, even when only a boost held the post: a later stale
  // copy then has this one to lose against. The merge keeps the newest
  // edit, so a late answer to an earlier edit changes nothing.
  return batch(() => {
    const cached = mergeStatus(fresh)
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

/**
 * Deletes the reader's own post. It leaves every list at once: the post and
 * each boost of it go from the cache, and its id is marked deleted for the
 * lists that keep their own copies. When the server refuses, everything
 * comes back and a toast says so. Resolves to the deleted post as the
 * server sent it (its `text` is the source, for a redraft), or null.
 */
export async function deleteOwnStatus(client: CaribouClient, status: Status): Promise<Status | null> {
  const id = (status.reblog ?? status).id
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
    const gone = await client.deleteStatus(id)
    if (generation !== ownerGeneration()) return null
    return gone
  } catch {
    // The account changed: the change already emptied the marks, and the
    // posts are the old account's.
    if (generation !== ownerGeneration()) return null
    batch(() => {
      const next = new Map(statusCache.peek())
      // A copy that came back meanwhile (a poll) is newer; keep it.
      for (const [key, s] of removed) if (!next.has(key)) next.set(key, s)
      statusCache.value = next
      const marks = new Set(deletedStatusIds.peek())
      marks.delete(id)
      deletedStatusIds.value = marks
    })
    toast('Could not delete this post. Try again.')
    return null
  }
}

function toast(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'error', message } }))
}
