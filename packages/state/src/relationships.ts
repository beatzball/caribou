import { signal } from '@preact/signals-core'
import type { mastodon } from 'masto'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { activeClient, activeUserKey } from './users.js'
import { ownerGeneration } from './keep-alive.js'

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

// Every write to one account's relationship goes through one queue, in the
// order the reader asked: a request starts only after the one before it has
// answered, so answers cannot arrive out of order. What the cache shows is
// the last answer with every write still waiting laid on top. A write that
// fails just leaves the queue, so the others keep their effect.
type RelationshipFlags = Partial<Pick<mastodon.v1.Relationship,
  'muting' | 'mutingNotifications' | 'blocking' | 'following' | 'requested'>>

interface Queue {
  // The relationship as the server last said, or as cached when the first
  // write started.
  confirmed: mastodon.v1.Relationship | undefined
  pending: RelationshipFlags[]
  tail: Promise<unknown>
}

const queues = new Map<string, Queue>()
// One follow click at a time per account: a second click while the first is
// on its way is dropped, since the button already shows what was asked.
const following = new Set<string>()
// Bumped when a write starts. A read compares it before and after its fetch:
// if a write started in between — still on its way or already done — the
// read carries older state than the write and must not replace it.
const revisions = new Map<string, number>()

/** Test-only — forgets queued writes between tests. */
export function _testOnlyResetRelationships(): void {
  queues.clear()
  following.clear()
  revisions.clear()
}

function shown(q: Queue, id: string): mastodon.v1.Relationship | undefined {
  if (!q.confirmed && q.pending.length === 0) return undefined
  let rel = q.confirmed ?? ({ id } as mastodon.v1.Relationship)
  for (const patch of q.pending) rel = { ...rel, ...patch }
  return rel
}

function enqueue(
  client: CaribouClient, accountId: string, patch: RelationshipFlags,
  call: (client: CaribouClient) => Promise<mastodon.v1.Relationship>, failure: string,
): Promise<boolean> {
  const key = relationshipKey(client.userKey, accountId)
  let q = queues.get(key)
  if (!q) {
    q = { confirmed: relationshipCache.value.get(key), pending: [], tail: Promise.resolve() }
    queues.set(key, q)
  }
  const queue = q
  // Nothing ahead: the request goes out now, in this task, as a single
  // write always did.
  const idle = queue.pending.length === 0
  queue.pending.push(patch)
  revisions.set(key, (revisions.get(key) ?? 0) + 1)
  put(key, shown(queue, accountId))
  const generation = ownerGeneration()
  const start = async () => {
    let ok = true
    try {
      queue.confirmed = await call(client)
    } catch {
      ok = false
      // The reader moved to another account meanwhile: this account's
      // failure is not theirs to read. The cache still rolls back.
      if (ownerGeneration() === generation) toast(failure)
    }
    queue.pending.splice(queue.pending.indexOf(patch), 1)
    put(key, shown(queue, accountId))
    if (queue.pending.length === 0 && queues.get(key) === queue) queues.delete(key)
    return ok
  }
  const run = idle ? start() : queue.tail.then(start)
  queue.tail = run
  return run
}

/** The relationship the cache shows, waiting writes included. */
function current(client: CaribouClient, accountId: string): mastodon.v1.Relationship | undefined {
  return relationshipCache.value.get(relationshipKey(client.userKey, accountId))
}

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
    if ((revisions.get(key) ?? 0) === revision && !queues.has(key)) put(key, rel)
    return relationshipCache.value.get(key) ?? rel
  } catch {
    return null
  }
}

/**
 * Reads the relationships of several accounts, 40 ids per request (a list
 * of search results). Like `loadRelationship`, an account with a write
 * started meanwhile keeps what the write shows. A failed read changes
 * nothing.
 */
export async function loadRelationships(
  accountIds: readonly string[], opts: RelationshipOpts = {},
): Promise<void> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client || accountIds.length === 0) return
  const chunks: string[][] = []
  for (let i = 0; i < accountIds.length; i += 40) chunks.push(accountIds.slice(i, i + 40))
  await Promise.all(chunks.map(async (ids) => {
    const before = new Map(ids.map((id) => [id, revisions.get(relationshipKey(client.userKey, id)) ?? 0]))
    let rels: mastodon.v1.Relationship[]
    try {
      rels = await client.fetchRelationships(ids)
    } catch {
      return
    }
    for (const rel of rels) {
      const key = relationshipKey(client.userKey, rel.id)
      if (!before.has(rel.id)) continue
      if ((revisions.get(key) ?? 0) === before.get(rel.id) && !queues.has(key)) put(key, rel)
    }
  }))
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
  if (following.has(key)) return
  const before = current(client, account.id)
  const undo = before?.following || before?.requested
  following.add(key)
  try {
    await (undo
      ? enqueue(client, account.id, { following: false, requested: false },
          (c) => c.unfollow(account.id), `Couldn't unfollow @${account.acct}.`)
      // A locked account takes a request, not a follow.
      : enqueue(client, account.id, { following: !account.locked, requested: !!account.locked },
          (c) => c.follow(account.id), `Couldn't follow @${account.acct}.`))
  } finally {
    following.delete(key)
  }
}

type Account = Pick<mastodon.v1.Account, 'id' | 'acct'>

// Writes the change at once, then asks the server in turn. Asking for what
// the cache already shows (a second Mute) sends nothing.
function writeFlags(
  account: Account, flag: 'muting' | 'blocking', on: boolean, patch: RelationshipFlags,
  call: (client: CaribouClient) => Promise<mastodon.v1.Relationship>,
  failure: string, opts: RelationshipOpts,
): Promise<boolean> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return Promise.resolve(false)
  // Only a known state counts: a listed mute the cache has not seen yet is
  // still a mute to undo.
  const known = current(client, account.id)?.[flag]
  if (known !== undefined && (known === true) === on) return Promise.resolve(true)
  return enqueue(client, account.id, patch, call, failure)
}

/**
 * Mutes the account (its posts and its notifications), or unmutes it. The
 * cache changes at once, so every post by the account leaves the lists; a
 * failure puts the old state back and says so. An unmute while the mute is
 * on its way runs after it, so the account ends unmuted. Resolves true when
 * the server took the change.
 */
export function setMute(account: Account, on: boolean, opts: RelationshipOpts = {}): Promise<boolean> {
  return on
    ? writeFlags(account, 'muting', true, { muting: true, mutingNotifications: true },
        (c) => c.mute(account.id), `Couldn't mute @${account.acct}.`, opts)
    : writeFlags(account, 'muting', false, { muting: false, mutingNotifications: false },
        (c) => c.unmute(account.id), `Couldn't unmute @${account.acct}.`, opts)
}

/**
 * Blocks the account, or unblocks it. A block also ends a follow either
 * way, so the follow flags drop with it. Ask the reader first: a block
 * removes the reader as a follower too.
 */
export function setBlock(account: Account, on: boolean, opts: RelationshipOpts = {}): Promise<boolean> {
  return on
    ? writeFlags(account, 'blocking', true, { blocking: true, following: false, requested: false },
        (c) => c.block(account.id), `Couldn't block @${account.acct}.`, opts)
    : writeFlags(account, 'blocking', false, { blocking: false },
        (c) => c.unblock(account.id), `Couldn't unblock @${account.acct}.`, opts)
}
