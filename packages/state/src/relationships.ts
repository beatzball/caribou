import { signal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import {
  accountRef, isWriteAck, type AccountRef, type CaribouClient, type Account, type Relationship,
  type RelationshipBluesky, type RelationshipWriteAck,
} from '@beatzball/caribou-mastodon-client'
import { activeClient, activeUserKey } from './users.js'
import { ownerGeneration } from './keep-alive.js'

// Keyed by the signed-in user as well as the account: account ids are minted
// per instance, and what one user follows says nothing about another.
// Treat it as read-only, like the caches — write through the functions here.
export const relationshipCache = signal<Map<string, Relationship>>(new Map())

export function relationshipKey(userKey: UserKey, accountId: string): string {
  return `${userKey} ${accountId}`
}

export function relationshipFor(
  accountId: string,
  userKey: UserKey | null = activeUserKey.value,
): Relationship | undefined {
  return userKey ? relationshipCache.value.get(relationshipKey(userKey, accountId)) : undefined
}

/**
 * True when the relationship says whether the reader follows the account.
 * A Bluesky ack with nothing cached leaves it unknown (README, "Bluesky
 * acks" A1): show no Follow / Unfollow choice until a read fills it.
 */
export function relationshipKnown(rel: Relationship | undefined): rel is Relationship {
  return rel !== undefined && typeof rel.following === 'boolean'
}

export interface RelationshipOpts {
  clientSource?: () => CaribouClient | null
  /**
   * The page the write was made on. Aborted when the page goes. Only
   * `setBlock` reads it: after a Bluesky Unblock it reads the follow again
   * while this page is up (#242).
   */
  signal?: AbortSignal
}

const defaultSource = () => activeClient.value

// Every write to one account's relationship goes through one queue, in the
// order the reader asked: a request starts only after the one before it has
// answered, so answers cannot arrive out of order. What the cache shows is
// the last answer with every write still waiting laid on top. A write that
// fails just leaves the queue, so the others keep their effect.
//
// The server's answer is kept whole, record refs included (a Bluesky follow
// or block record), so a rollback puts the old refs back too. A Bluesky ack
// names only what its write changed; it goes over the last answer (A1). A
// write builds its ref when it starts, from the last answer: an unfollow
// queued behind a follow names the record that follow made. So while an
// undo waits, the cache can show `following: false` with the `followUri`
// still set, on purpose: the next write builds its ref from
// `queue.confirmed`.
type RelationshipFlags = Partial<Pick<Relationship,
  'muting' | 'mutingNotifications' | 'blocking' | 'following' | 'requested'>>

// The field groups a write names (README, "Viewer state", relationships).
// A read is judged one group at a time.
type Group = 'follow' | 'block' | 'mute'
const GROUPS: readonly Group[] = ['follow', 'block', 'mute']
const FLAGS: Record<Group, readonly (keyof RelationshipFlags)[]> = {
  follow: ['following', 'requested'],
  block: ['blocking'],
  mute: ['muting', 'mutingNotifications'],
}
const REFS: Record<Group, readonly (keyof RelationshipBluesky)[]> = {
  follow: ['followUri'],
  block: ['blockUri', 'blockingByList'],
  mute: ['mutingByList'],
}

// `whole`: the write's answer is (or, while it is out, will be) the whole
// relationship, as Mastodon answers. Only a Bluesky ack is partial.
interface Pending { patch: RelationshipFlags; groups: readonly Group[]; whole: boolean }

interface Queue {
  // The relationship as the server last said, or as cached when the first
  // write started.
  confirmed: Relationship | undefined
  pending: Pending[]
  tail: Promise<unknown>
}

interface GroupState {
  // The key's revision when the last write to this group started.
  started: number
  // What the last write to this group left, when it finished, and the
  // client's lag window (`capabilities.readLagMs`: 60 s on Bluesky, whose
  // AppView can lag behind a write; 0 on Mastodon).
  claim?: { time: number; lagMs: number; rel: Relationship }
}

const queues = new Map<string, Queue>()
// One follow click at a time per account: a second click while the first is
// on its way is dropped, since the button already shows what was asked.
const following = new Set<string>()
// Bumped when a write starts. A read records it before its fetch.
const revisions = new Map<string, number>()
const groupStates = new Map<string, Map<Group, GroupState>>()
// The revision of the last write that answers the whole relationship
// (Mastodon), set when it starts: a failed one counts too, as before acks.
const wholeWrites = new Map<string, number>()

function groupState(key: string, g: Group): GroupState | undefined {
  return groupStates.get(key)?.get(g)
}

function setGroupState(key: string, g: Group, next: GroupState): void {
  let m = groupStates.get(key)
  if (!m) groupStates.set(key, m = new Map())
  m.set(g, next)
}

// The read disagrees with what the write left: a flag, or a record ref
// (A2). Only the fields the write's answer named are compared.
function disagrees(read: Relationship, claim: Relationship, g: Group): boolean {
  for (const f of FLAGS[g]) {
    if (claim[f] !== undefined && (read[f] === true) !== (claim[f] === true)) return true
  }
  const cb = claim.bluesky
  if (!cb) return false
  for (const r of REFS[g]) {
    if (cb[r] !== undefined && (read.bluesky?.[r] ?? null) !== (cb[r] ?? null)) return true
  }
  return false
}

// The cached fields of this group stay: a write to it is out, one started
// after the read did, or the read lags behind the last one.
function keeps(key: string, g: Group, revision: number, read: Relationship): boolean {
  if (queues.get(key)?.pending.some((p) => p.groups.includes(g))) return true
  const st = groupState(key, g)
  if (!st) return false
  if (st.started > revision) return true
  const c = st.claim
  return !!c && Date.now() - c.time < c.lagMs && disagrees(read, c.rel, g)
}

// `target` with this group's fields as `source` has them. A field the
// source does not have is unknown, so it is left out.
function withGroup(target: Relationship, source: Relationship | undefined, g: Group): Relationship {
  const out = { ...target } as Record<string, unknown>
  for (const f of FLAGS[g]) {
    if (source?.[f] !== undefined) out[f] = source[f]
    else delete out[f]
  }
  if (target.bluesky || source?.bluesky) {
    const b = { ...target.bluesky } as Record<string, unknown>
    for (const r of REFS[g]) {
      if (source?.bluesky?.[r] !== undefined) b[r] = source.bluesky[r]
      else delete b[r]
    }
    out.bluesky = b
  }
  return out as unknown as Relationship
}

// The read, with each kept group as `base` has it.
function merged(key: string, revision: number, read: Relationship, base: Relationship | undefined): Relationship {
  let out = read
  for (const g of GROUPS) if (keeps(key, g, revision, read)) out = withGroup(out, base, g)
  return out
}

// A whole answer (Mastodon) is newer than every field of a read that
// started before its write, so that read is dropped whole, as before acks
// existed. The group rule is for partial acks only (README, R2-3).
function wholeWriteSince(key: string, revision: number): boolean {
  if (queues.get(key)?.pending.some((p) => p.whole)) return true
  return (wholeWrites.get(key) ?? 0) > revision
}

// What a read changes: the cached relationship, and the last answer of a
// queue still running, so its writes land on the read's other fields.
function applyRead(key: string, revision: number, read: Relationship, into: Map<string, Relationship>): void {
  if (wholeWriteSince(key, revision)) return
  const q = queues.get(key)
  if (q) {
    q.confirmed = merged(key, revision, read, q.confirmed)
    const rel = shown(q, read.id)
    if (rel) into.set(key, rel)
    return
  }
  into.set(key, merged(key, revision, read, into.get(key)))
}

/** Test-only — forgets queued writes between tests. */
export function _testOnlyResetRelationships(): void {
  queues.clear()
  following.clear()
  revisions.clear()
  groupStates.clear()
  wholeWrites.clear()
}

function shown(q: Queue, id: string): Relationship | undefined {
  if (!q.confirmed && q.pending.length === 0) return undefined
  let rel = q.confirmed ?? ({ id } as Relationship)
  for (const { patch } of q.pending) rel = { ...rel, ...patch }
  return rel
}

// A refusal the client explains (a list block): its own words.
function userMessage(err: unknown): string | null {
  const m = (err as { userMessage?: unknown } | null)?.userMessage
  return typeof m === 'string' && m !== '' ? m : null
}

function enqueue(
  client: CaribouClient, accountId: string, patch: RelationshipFlags, groups: readonly Group[],
  call: (client: CaribouClient, ref: AccountRef) => Promise<Relationship | RelationshipWriteAck>, failure: string,
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
  const entry: Pending = { patch, groups, whole: client.capabilities?.network !== 'bluesky' }
  queue.pending.push(entry)
  const revision = (revisions.get(key) ?? 0) + 1
  revisions.set(key, revision)
  for (const g of groups) setGroupState(key, g, { ...groupState(key, g), started: revision })
  if (entry.whole) wholeWrites.set(key, revision)
  put(key, shown(queue, accountId))
  const generation = ownerGeneration()
  const start = async () => {
    let ok = true
    try {
      const answer = await call(client, accountRef(accountId, queue.confirmed))
      entry.whole = !isWriteAck(answer)
      queue.confirmed = entry.whole ? (answer as Relationship) : withAck(queue.confirmed, accountId, answer as RelationshipWriteAck)
      const claim = { time: Date.now(), lagMs: client.capabilities?.readLagMs ?? 0, rel: queue.confirmed }
      for (const g of groups) setGroupState(key, g, { ...groupState(key, g)!, claim })
    } catch (err) {
      ok = false
      // The reader moved to another account meanwhile: this account's
      // failure is not theirs to read. The cache still rolls back.
      if (ownerGeneration() === generation) toast(userMessage(err) ?? failure)
    }
    queue.pending.splice(queue.pending.indexOf(entry), 1)
    put(key, shown(queue, accountId))
    if (queue.pending.length === 0 && queues.get(key) === queue) queues.delete(key)
    return ok
  }
  const run = idle ? start() : queue.tail.then(start)
  queue.tail = run
  return run
}

// A Bluesky write answers only what it changed: its flags and record refs
// go over the last answer, and every other field stays as it was. With
// nothing cached, the other fields stay unknown (A1).
function withAck(
  confirmed: Relationship | undefined, accountId: string, ack: RelationshipWriteAck,
): Relationship {
  const base = confirmed ?? ({ id: accountId } as Relationship)
  return {
    ...base,
    ...ack.flags,
    ...(ack.bluesky ? { bluesky: { ...base.bluesky, ...ack.bluesky } as RelationshipBluesky } : {}),
  }
}

/** The relationship the cache shows, waiting writes included. */
function current(client: CaribouClient, accountId: string): Relationship | undefined {
  return relationshipCache.value.get(relationshipKey(client.userKey, accountId))
}

function put(key: string, rel: Relationship | undefined): void {
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
): Promise<Relationship | null> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return null
  const key = relationshipKey(client.userKey, accountId)
  const revision = revisions.get(key) ?? 0
  try {
    const [rel] = await client.fetchRelationships([accountId])
    if (!rel) return null
    const next = new Map(relationshipCache.value)
    applyRead(key, revision, rel, next)
    relationshipCache.value = next
    return relationshipCache.value.get(key) ?? rel
  } catch {
    return null
  }
}

/**
 * Reads the relationships of several accounts, 40 ids per request (a list
 * of search results). Like `loadRelationship`, each group with a write
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
    let rels: Relationship[]
    try {
      rels = await client.fetchRelationships(ids)
    } catch {
      return
    }
    // One new map for the whole batch, so the cache changes once.
    const next = new Map(relationshipCache.value)
    let changed = false
    for (const rel of rels) {
      const revision = before.get(rel.id)
      if (revision === undefined) continue
      applyRead(relationshipKey(client.userKey, rel.id), revision, rel, next)
      changed = true
    }
    if (changed) relationshipCache.value = next
  }))
}

// Follows the account, or unfollows it when it is followed or a follow
// request is pending (unfollow also withdraws a request). The button changes
// at once; a failed request puts the old state back and says so. While
// `following` is unknown (A1), it does nothing: a screen shows no button.
export async function toggleFollow(
  account: Pick<Account, 'id' | 'acct' | 'locked'>, opts: RelationshipOpts = {},
): Promise<void> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return
  const key = relationshipKey(client.userKey, account.id)
  if (following.has(key)) return
  const before = current(client, account.id)
  // Unknown only when an answer lacks it (a Bluesky ack): a write still on
  // its way with nothing cached says nothing about the follow.
  const q = queues.get(key)
  const answered = q ? q.confirmed : before
  if (answered && typeof answered.following !== 'boolean') return
  const undo = before?.following || before?.requested
  following.add(key)
  try {
    await (undo
      ? enqueue(client, account.id, { following: false, requested: false }, ['follow'],
          (c, ref) => c.unfollow(ref), `Couldn't unfollow @${account.acct}.`)
      // A locked account takes a request, not a follow.
      : enqueue(client, account.id, { following: !account.locked, requested: !!account.locked }, ['follow'],
          (c, ref) => c.follow(ref), `Couldn't follow @${account.acct}.`))
  } finally {
    following.delete(key)
  }
}

type AccountHandle = Pick<Account, 'id' | 'acct'>

// Writes the change at once, then asks the server in turn. Asking for what
// the cache already shows (a second Mute) sends nothing.
function writeFlags(
  client: CaribouClient | null, account: AccountHandle, flag: 'muting' | 'blocking', on: boolean,
  patch: RelationshipFlags, groups: readonly Group[],
  call: (client: CaribouClient, ref: AccountRef) => Promise<Relationship | RelationshipWriteAck>,
  failure: string,
): Promise<boolean> {
  if (!client) return Promise.resolve(false)
  // Only a known state counts: a listed mute the cache has not seen yet is
  // still a mute to undo.
  const known = current(client, account.id)?.[flag]
  if (known !== undefined && (known === true) === on) return Promise.resolve(true)
  return enqueue(client, account.id, patch, groups, call, failure)
}

const LIST_BLOCK = 'This block comes from a list. Remove the account from the list, or unsubscribe from it.'
const LIST_MUTE = 'This mute comes from a list. Remove the account from the list, or unsubscribe from it.'

// A3: a personal undo cannot remove a list's block or mute. It is refused
// with the reason; nothing is sent and the cache stays.
function fromList(client: CaribouClient | null, account: AccountHandle, ref: 'blockingByList' | 'mutingByList'): boolean {
  if (!client || !current(client, account.id)?.bluesky?.[ref]) return false
  toast(ref === 'blockingByList' ? LIST_BLOCK : LIST_MUTE)
  return true
}

/**
 * Mutes the account (its posts and its notifications), or unmutes it. The
 * cache changes at once, so every post by the account leaves the lists; a
 * failure puts the old state back and says so. An unmute while the mute is
 * on its way runs after it, so the account ends unmuted. A Bluesky mute
 * that comes from a list is not unmuted here (A3). Resolves true when the
 * server took the change.
 */
export function setMute(account: AccountHandle, on: boolean, opts: RelationshipOpts = {}): Promise<boolean> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!on && fromList(client, account, 'mutingByList')) return Promise.resolve(false)
  return on
    ? writeFlags(client, account, 'muting', true, { muting: true, mutingNotifications: true }, ['mute'],
        (c, ref) => c.mute(ref), `Couldn't mute @${account.acct}.`)
    : writeFlags(client, account, 'muting', false, { muting: false, mutingNotifications: false }, ['mute'],
        (c, ref) => c.unmute(ref), `Couldn't unmute @${account.acct}.`)
}

/**
 * Blocks the account, or unblocks it. On Mastodon a block also ends a
 * follow either way, so the follow flags drop with it; a Bluesky block
 * leaves the follow record. Ask the reader first: a block removes the
 * reader as a follower too. A Bluesky block that comes from a list is not
 * unblocked here (A3).
 */
export function setBlock(account: AccountHandle, on: boolean, opts: RelationshipOpts = {}): Promise<boolean> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!on && fromList(client, account, 'blockingByList')) return Promise.resolve(false)
  const bluesky = client?.capabilities?.network === 'bluesky'
  return on
    ? writeFlags(client, account, 'blocking', true,
        bluesky ? { blocking: true } : { blocking: true, following: false, requested: false },
        bluesky ? ['block'] : ['block', 'follow'],
        (c, ref) => c.block(ref), `Couldn't block @${account.acct}.`)
    : writeFlags(client, account, 'blocking', false, { blocking: false }, ['block'],
        (c, ref) => c.unblock(ref), `Couldn't unblock @${account.acct}.`).then((ok) => {
        // A Bluesky read made while blocked does not show the follow (R2-1),
        // so it is unknown: read it again now the block is gone.
        if (ok && bluesky && client) void readFollowAfterUnblock(client, account.id, opts.signal)
        return ok
      })
}

/** After an Unblock, when to read the follow again: inside the 60 s lag window. */
const UNBLOCK_REREADS_MS: readonly number[] = [5_000, 20_000, 60_000]

/** Waits `ms`, or less when `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })
}

// The first read after an Unblock can still see the block, since the AppView
// lags, and then the follow stays unknown (R2-1). With a page `signal`, read
// again at 5 s, 20 s and 60 s while the follow is unknown and no block is
// known. Stop when the page goes or the active account changes (#242).
async function readFollowAfterUnblock(client: CaribouClient, accountId: string, signal: AbortSignal | undefined): Promise<void> {
  const generation = ownerGeneration()
  const key = relationshipKey(client.userKey, accountId)
  const opts = { clientSource: () => client }
  const start = Date.now()
  await loadRelationship(accountId, opts)
  if (!signal) return
  for (const at of UNBLOCK_REREADS_MS) {
    await wait(Math.max(0, start + at - Date.now()), signal)
    if (signal.aborted || ownerGeneration() !== generation) return
    const rel = relationshipCache.value.get(key)
    if (!rel || typeof rel.following === 'boolean' || rel.blocking === true) return
    await loadRelationship(accountId, opts)
  }
}
