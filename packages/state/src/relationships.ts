import { signal } from '@preact/signals-core'
import type { mastodon } from 'masto'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { activeClient, activeUserKey } from './users.js'

// Keyed by the signed-in user as well as the account: account ids are minted
// per instance, and what one user follows says nothing about another.
// Treat it as read-only, like the caches — write through the functions here.
export const relationshipCache = signal<Map<string, mastodon.v1.Relationship>>(new Map())

export function relationshipKey(userKey: UserKey, accountId: string): string {
  return `${userKey} ${accountId}`
}

export function relationshipFor(
  accountId: string,
  userKey: UserKey | null = activeUserKey.value,
): mastodon.v1.Relationship | undefined {
  return userKey ? relationshipCache.value.get(relationshipKey(userKey, accountId)) : undefined
}

export interface RelationshipOpts {
  clientSource?: () => CaribouClient | null
}

const defaultSource = () => activeClient.value

// One write per account at a time. A second click while the first is on its
// way is dropped: the button already shows the state the first one asked for.
const writing = new Set<string>()
// Bumped when a write starts. A read compares it before and after its fetch:
// if a write started in between — still on its way or already done — the
// read carries older state than the write and must not replace it.
const revisions = new Map<string, number>()

function put(key: string, rel: mastodon.v1.Relationship | undefined): void {
  const next = new Map(relationshipCache.value)
  if (rel) next.set(key, rel)
  else next.delete(key)
  relationshipCache.value = next
}

function toast(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'error', message } }))
}

export async function loadRelationship(
  accountId: string, opts: RelationshipOpts = {},
): Promise<mastodon.v1.Relationship | null> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return null
  const key = relationshipKey(client.userKey, accountId)
  const revision = revisions.get(key) ?? 0
  try {
    const [rel] = await client.fetchRelationships([accountId])
    if (!rel) return null
    if ((revisions.get(key) ?? 0) === revision) put(key, rel)
    return relationshipCache.value.get(key) ?? rel
  } catch {
    return null
  }
}

// Follows the account, or unfollows it when it is followed or a follow
// request is pending (unfollow also withdraws a request). The button changes
// at once; a failed request puts the old state back and says so.
export async function toggleFollow(
  account: Pick<mastodon.v1.Account, 'id' | 'acct' | 'locked'>, opts: RelationshipOpts = {},
): Promise<void> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return
  const key = relationshipKey(client.userKey, account.id)
  if (writing.has(key)) return
  const before = relationshipCache.value.get(key)
  const undo = before?.following || before?.requested
  const base = before ?? ({ id: account.id } as mastodon.v1.Relationship)
  put(key, undo
    ? { ...base, following: false, requested: false }
    // A locked account takes a request, not a follow.
    : { ...base, following: !account.locked, requested: !!account.locked })
  writing.add(key)
  revisions.set(key, (revisions.get(key) ?? 0) + 1)
  try {
    const rel = undo ? await client.unfollow(account.id) : await client.follow(account.id)
    put(key, rel)
  } catch {
    put(key, before)
    toast(undo ? `Couldn't unfollow @${account.acct}.` : `Couldn't follow @${account.acct}.`)
  } finally {
    writing.delete(key)
  }
}
