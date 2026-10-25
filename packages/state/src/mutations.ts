import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'
import { statusCache } from './caches.js'
import { activeClient } from './users.js'

type Status = mastodon.v1.Status
type Flag = 'favourited' | 'reblogged' | 'bookmarked'
type Count = 'favouritesCount' | 'reblogsCount'
type Method = 'favourite' | 'unfavourite' | 'reblog' | 'unreblog' | 'bookmark' | 'unbookmark'

export type StatusAction = 'favourite' | 'reblog' | 'bookmark'

interface ActionSpec {
  flag: Flag
  count: Count | null
  on: Method
  off: Method
}

const SPECS: Record<StatusAction, ActionSpec> = {
  favourite: { flag: 'favourited', count: 'favouritesCount', on: 'favourite', off: 'unfavourite' },
  reblog:    { flag: 'reblogged',  count: 'reblogsCount',    on: 'reblog',    off: 'unreblog' },
  bookmark:  { flag: 'bookmarked', count: null,              on: 'bookmark',  off: 'unbookmark' },
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
// is in flight is dropped: queuing it would race the first response, and
// the button already shows the state the user asked for.
const inflight = new Set<string>()

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

  const spec = SPECS[action]
  const before = statusCache.value.get(id) ?? findWrapped(id) ?? target
  const wasOn = before[spec.flag] === true
  const method = wasOn ? spec.off : spec.on
  const undo: Partial<Status> = { [spec.flag]: wasOn }
  const optimistic: Partial<Status> = { [spec.flag]: !wasOn }
  if (spec.count) {
    undo[spec.count] = before[spec.count]
    optimistic[spec.count] = Math.max(0, before[spec.count] + (wasOn ? -1 : 1))
  }

  inflight.add(key)
  patchPost(id, optimistic)
  try {
    const fresh = await client[method](id)
    // Another action on the same post may still be in flight. Its
    // optimistic value is newer than what this response carries.
    const keep: Partial<Status> = {}
    for (const [other, s] of Object.entries(SPECS) as [StatusAction, ActionSpec][]) {
      if (other === action || !inflight.has(`${other}:${id}`)) continue
      const current = statusCache.value.get(id) ?? findWrapped(id)
      if (!current) continue
      keep[s.flag] = current[s.flag]
      if (s.count) keep[s.count] = current[s.count]
    }
    replacePost({ ...fresh, ...keep })
  } catch {
    patchPost(id, undo)
    toast(`Could not ${VERBS[method]} this post. Try again.`)
  } finally {
    inflight.delete(key)
  }
}

function findWrapped(id: string): Status | undefined {
  for (const s of statusCache.value.values()) {
    if (s.reblog?.id === id) return s.reblog
  }
  return undefined
}

function patchPost(id: string, patch: Partial<Status>): void {
  writePost(id, (post) => ({ ...post, ...patch }))
}

function replacePost(post: Status): void {
  writePost(post.id, () => post)
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
