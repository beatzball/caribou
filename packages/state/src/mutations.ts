import { statusRef, type CaribouClient, type Status } from '@beatzball/caribou-mastodon-client'
import { statusCache } from './caches.js'
import { inflight } from './inflight.js'
import { ownerGeneration } from './keep-alive.js'
import { activeClient } from './users.js'
import { slotWriteFinished, slotWriteStarted, type Slot } from './viewer-slots.js'

type Flag = 'favourited' | 'reblogged' | 'bookmarked'
type Count = 'favouritesCount' | 'reblogsCount'
// The record an action makes on Bluesky, which its undo deletes.
type RecordRef = 'likeUri' | 'repostUri'
type Method = 'favourite' | 'unfavourite' | 'reblog' | 'unreblog' | 'bookmark' | 'unbookmark'

export type StatusAction = 'favourite' | 'reblog' | 'bookmark'

interface ActionSpec {
  slot: Slot
  flag: Flag
  count: Count | null
  record: RecordRef | null
  on: Method
  off: Method
}

const SPECS: Record<StatusAction, ActionSpec> = {
  favourite: { slot: 'like',     flag: 'favourited', count: 'favouritesCount', record: 'likeUri',   on: 'favourite', off: 'unfavourite' },
  reblog:    { slot: 'repost',   flag: 'reblogged',  count: 'reblogsCount',    record: 'repostUri', on: 'reblog',    off: 'unreblog' },
  bookmark:  { slot: 'bookmark', flag: 'bookmarked', count: null,              record: null,        on: 'bookmark',  off: 'unbookmark' },
}

const VERBS: Record<Method, string> = {
  favourite: 'favourite', unfavourite: 'unfavourite',
  reblog: 'boost', unreblog: 'undo the boost of',
  bookmark: 'bookmark', unbookmark: 'remove the bookmark from',
}

export interface MutationOpts {
  clientSource?: () => CaribouClient | null
}

// One write per action per post at a time. A second click while the first
// is in flight is dropped, so a quick favourite-then-undo leaves the post
// favourited; the user clicks again once the button settles. Queuing the
// last intent would fix that, at the cost of ordering two writes.

/** Test-only — clears the in-flight guard between tests. */
export function _testOnlyResetMutations(): void {
  inflight.clear()
}

export function toggleFavourite(status: Status, opts?: MutationOpts): Promise<void> {
  return toggle('favourite', status, opts)
}

export function toggleReblog(status: Status, opts?: MutationOpts): Promise<void> {
  return toggle('reblog', status, opts)
}

export function toggleBookmark(status: Status, opts?: MutationOpts): Promise<void> {
  return toggle('bookmark', status, opts)
}

async function toggle(action: StatusAction, status: Status, opts: MutationOpts = {}): Promise<void> {
  // A boost in a timeline is a wrapper; the action belongs to the post it
  // wraps, and the server knows it by that post's id.
  const target = status.reblog ?? status
  const id = target.id
  const key = `${action}:${id}`
  if (inflight.has(key)) return
  const client = (opts.clientSource ?? (() => activeClient.value))()
  if (!client) return

  const { slot, flag, count, record } = SPECS[action]
  const before = statusCache.value.get(id) ?? findWrapped(id) ?? target
  const wasOn = before[flag] === true
  // The ref carries the record an undo deletes, as the cache knows it now.
  const ref = statusRef(before)
  const oldRecord = record ? before.bluesky?.[record] ?? null : null
  const method = wasOn ? SPECS[action].off : SPECS[action].on
  const delta = wasOn ? -1 : 1

  // Every write below changes only this action's flag, count and record
  // ref (Bluesky), and each
  // starts from the post as the cache holds it at that moment. A poll, a
  // page load or another action may write the same post while the request
  // is out; their fields must survive this one finishing.
  //
  // The flags in the cache belong to the active account. A result that
  // lands after the account changed is the old account's, so it writes
  // nothing, not even the rollback: the change already dropped the
  // optimistic flag (`forgetReaderFields`).
  const generation = ownerGeneration()
  inflight.add(key)
  // The slot rule: no copy changes this slot while the write is out, and a
  // copy fetched before it finished never does (README, "Viewer state").
  slotWriteStarted(id, slot)
  // An undo removes the record at once, with the flag; a new record is
  // known only once the server answers.
  writePost(id, (post) => withRecord(shift(post, flag, !wasOn, count, delta), record, wasOn ? null : undefined))
  try {
    const fresh = await client[method](ref)
    if (generation !== ownerGeneration()) return
    writePost(id, (post) => withRecord({
      ...post,
      [flag]: fresh[flag],
      ...(count ? { [count]: fresh[count] } : {}),
    }, record, record ? fresh.bluesky?.[record] : undefined))
    slotWriteFinished(id, slot, fresh[flag] === true, lagOf(client))
  } catch {
    if (generation !== ownerGeneration()) return
    // Undo only what this click did. If the flag no longer holds the
    // optimistic value, a newer write already set it from the server.
    writePost(id, (post) => post[flag] === !wasOn
      ? withRecord(shift(post, flag, wasOn, count, -delta), record, oldRecord)
      : post)
    slotWriteFinished(id, slot, wasOn, lagOf(client))
    toast(`Could not ${VERBS[method]} this post. Try again.`)
  } finally {
    inflight.delete(key)
  }
}

// How long the client's reads can lag behind this write (0 for Mastodon).
function lagOf(client: CaribouClient): number {
  return client.capabilities?.readLagMs ?? 0
}

function shift(post: Status, flag: Flag, on: boolean, count: Count | null, delta: number): Status {
  const next = { ...post, [flag]: on }
  if (count) next[count] = Math.max(0, (post[count] ?? 0) + delta)
  return next
}

// Sets the action's record ref on a Bluesky post. `undefined` leaves it as
// it is; a Mastodon post has no refs and is returned unchanged.
function withRecord(post: Status, record: RecordRef | null, value: string | null | undefined): Status {
  if (!record || value === undefined || !post.bluesky) return post
  return { ...post, bluesky: { ...post.bluesky, [record]: value } }
}

function findWrapped(id: string): Status | undefined {
  for (const s of statusCache.value.values()) {
    if (s.reblog?.id === id) return s.reblog
  }
  return undefined
}

// The post and every wrapper that boosts it change in one cache write, so
// a timeline that shows both never renders them out of step.
function writePost(id: string, next: (post: Status) => Status): void {
  const cache = statusCache.value
  let out: Map<string, Status> | null = null
  const own = cache.get(id)
  if (own) {
    out = new Map(cache)
    out.set(id, next(own))
  }
  for (const [key, s] of cache) {
    if (s.reblog?.id !== id) continue
    out ??= new Map(cache)
    out.set(key, { ...s, reblog: next(s.reblog) })
  }
  if (out) statusCache.value = out
}

function toast(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'error', message } }))
}
