import { effect } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import { forgetReaderFields } from './caches.js'
import { activeUserKey } from './users.js'

/**
 * An in-memory cache that outlives the element that filled it, so a page the
 * reader comes back to can paint at once. It holds at most `max` entries and
 * drops the least recently used one first.
 *
 * Every entry belongs to the account that was active when it was written. When
 * the active account changes — a switch, a sign-out, or a 401 that removes the
 * session — the whole cache is emptied, so one account never sees another's
 * posts. Keys need not name the account.
 *
 * Client only: the server has no active account, and a process-wide cache on
 * the server would hand one visitor's data to the next.
 */
export interface KeepAlive<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  /** The entry for `key`, made with `create` when there is none. */
  getOrCreate(key: string, create: () => T): T
  has(key: string): boolean
  clear(): void
  readonly size: number
}

// Every cache made here lives for the whole page session; the set holds them
// so an account change can empty them all. Make keep-alives at module level,
// never per element, or the set grows with every mount.
const all = new Set<KeepAlive<unknown>>()
let owner: UserKey | null | undefined
let generation = 0
let watching = false

// Reading `owner` on every call covers a change made before the effect was
// installed; the effect frees the memory as soon as the account changes.
function checkOwner(): void {
  const current = activeUserKey.peek()
  if (owner === current) return
  const first = owner === undefined
  owner = current
  generation++
  for (const cache of all) cache.clear()
  // The status cache holds the reader's own flags on every post
  // (favourited, bookmarked …). They belong to the account that fetched
  // them. The first owner is the one the page loaded with, so there is
  // nothing to drop yet.
  if (!first) forgetReaderFields()
}

function watchOwner(): void {
  if (watching) return
  watching = true
  effect(() => {
    void activeUserKey.value
    checkOwner()
  })
}

/**
 * A number that changes whenever the active account does, including a change
 * and back (A → B → A). Read it before a request and compare after: a result
 * that arrives under another generation belongs to an earlier account and
 * must be dropped.
 */
export function ownerGeneration(): number {
  watchOwner()
  checkOwner()
  return generation
}

export function createKeepAlive<T>(max: number): KeepAlive<T> {
  const entries = new Map<string, T>()

  function touch(key: string, value: T): void {
    entries.delete(key)
    entries.set(key, value)
    while (entries.size > max) {
      const oldest = entries.keys().next().value as string
      entries.delete(oldest)
    }
  }

  const cache: KeepAlive<T> = {
    get(key) {
      watchOwner()
      checkOwner()
      const value = entries.get(key)
      if (value !== undefined) touch(key, value)
      return value
    },
    set(key, value) {
      watchOwner()
      checkOwner()
      touch(key, value)
    },
    getOrCreate(key, create) {
      const found = cache.get(key)
      if (found !== undefined) return found
      const made = create()
      touch(key, made)
      return made
    },
    has(key) {
      watchOwner()
      checkOwner()
      return entries.has(key)
    },
    clear() { entries.clear() },
    get size() { return entries.size },
  }
  all.add(cache as KeepAlive<unknown>)
  return cache
}

/** Empties every keep-alive cache. Tests call it between cases. */
export function clearKeptAlive(): void {
  for (const cache of all) cache.clear()
}
