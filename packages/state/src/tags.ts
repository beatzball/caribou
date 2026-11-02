import { signal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { activeClient, activeUserKey } from './users.js'

// Whether a signed-in user follows a hashtag, keyed by the user and the
// tag's normalized name. Treat it as read-only — write through the functions
// here.
export const tagCache = signal<Map<string, boolean>>(new Map())

// Mastodon treats `#AI` and `#ai` as one tag, and a name typed with a
// combining accent as the same tag as its composed form.
export function normalizeTagName(name: string): string {
  return name.normalize('NFKC').toLowerCase()
}

export function tagKey(userKey: UserKey, name: string): string {
  return `${userKey} ${normalizeTagName(name)}`
}

/** Whether the active account follows the tag; undefined while not known. */
export function tagFollowing(name: string, userKey: UserKey | null = activeUserKey.value): boolean | undefined {
  return userKey ? tagCache.value.get(tagKey(userKey, name)) : undefined
}

export interface TagOpts {
  clientSource?: () => CaribouClient | null
}

const defaultSource = () => activeClient.value

// One write per tag at a time, and a revision per tag so a read that was on
// its way while a write started does not replace the write's state. The
// same rules as `relationships.ts`.
const writing = new Set<string>()
const revisions = new Map<string, number>()

function put(key: string, following: boolean): void {
  const next = new Map(tagCache.value)
  next.set(key, following)
  tagCache.value = next
}

function toast(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'error', message } }))
}

export async function loadTag(name: string, opts: TagOpts = {}): Promise<void> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return
  const key = tagKey(client.userKey, name)
  const revision = revisions.get(key) ?? 0
  let following = false
  try {
    following = !!(await client.fetchTag(name)).following
  } catch {
    // An older server answers 404 for a tag nobody has used. Nobody follows
    // it, and the reader can still follow it.
  }
  if ((revisions.get(key) ?? 0) === revision) put(key, following)
}

// The button changes at once; a failed request puts the old state back and
// says so.
export async function toggleTagFollow(name: string, opts: TagOpts = {}): Promise<void> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return
  const key = tagKey(client.userKey, name)
  if (writing.has(key)) return
  const before = tagCache.value.get(key) ?? false
  put(key, !before)
  writing.add(key)
  revisions.set(key, (revisions.get(key) ?? 0) + 1)
  try {
    const t = before ? await client.unfollowTag(name) : await client.followTag(name)
    put(key, t.following ?? !before)
  } catch {
    put(key, before)
    toast(before ? `Couldn't unfollow #${name}.` : `Couldn't follow #${name}.`)
  } finally {
    writing.delete(key)
  }
}
