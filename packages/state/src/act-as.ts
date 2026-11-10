import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError, isWriteAck, type CaribouClient, type Status } from '@beatzball/caribou-mastodon-client'
import { deferredBlueskyClient, isBlueskySession } from './bluesky-session.js'
import { inflight } from './inflight.js'
import type { StatusAction } from './mutations.js'
import { activeUserKey, emitSessionExpired, userName, users, type BlueskySession, type UserSession } from './users.js'

// The rules are in the package README, "Act as another account". The
// numbers in the comments below name them.

/** Another account's own view of a post: its flags and the records its undo deletes. */
export interface ActAsView {
  favourited: boolean
  reblogged: boolean
  bookmarked: boolean
  likeUri: string | null
  repostUri: string | null
}

export type ActAsResult =
  | { kind: 'ok'; view: ActAsView }
  | { kind: 'expired' }
  | { kind: 'busy' }
  | { kind: 'failed'; message: string }

const SPECS = {
  favourite: { flag: 'favourited', record: 'likeUri', on: 'favourite', off: 'unfavourite', verb: ['favourite', 'unfavourite'] },
  reblog: { flag: 'reblogged', record: 'repostUri', on: 'reblog', off: 'unreblog', verb: ['boost', 'undo the boost of'] },
  bookmark: { flag: 'bookmarked', record: null, on: 'bookmark', off: 'unbookmark', verb: ['bookmark', 'remove the bookmark from'] },
} as const satisfies Record<StatusAction, unknown>

/**
 * Rule 1: the signed-in accounts, other than the active one, on the post's
 * network. A Bluesky post: the Bluesky accounts. A Mastodon post: none
 * until #131. Expired accounts are listed. Reads signals, so an effect
 * that calls it runs again when the accounts change.
 */
export function actAsAccounts(status: Status): UserSession[] {
  const post = status.reblog ?? status
  if (!post.bluesky) return []
  const active = activeUserKey.value
  return [...users.value.values()].filter((u) => isBlueskySession(u) && u.userKey !== active)
}

// One client per sign-in, so its restore runs once.
const clients = new Map<string, CaribouClient>()

// Rule 8: the writes the server acked, by `<sign-in> <post> <action>`, and
// the writes still out, by `<sign-in> <post>`. A sign-in is
// `<userKey> <generation>`. Apart from the active reader's slots.
interface Kept { on: boolean; record: string | null; seq: number; at: number; lagMs: number }
const kept = new Map<string, Kept>()
const writing = new Map<string, Set<Promise<unknown>>>()
// Counts finished writes, so a read knows which finished after it started.
let seq = 0

/** Tests only: forget the clients made and the writes kept. */
export function _testOnlyResetActAs(): void {
  clients.clear()
  kept.clear()
  writing.clear()
  seq = 0
}

const signIn = (s: BlueskySession) => `${s.userKey} ${s.generation}`

// Rule 9: drops what belongs to a sign-in that is no longer stored.
function forgetOldSignIns(): void {
  const live = new Set([...users.peek().values()].filter(isBlueskySession).map(signIn))
  const old = (key: string) => !live.has(key.split(' ').slice(0, 2).join(' '))
  for (const map of [clients, kept, writing] as Map<string, unknown>[]) {
    for (const key of [...map.keys()]) if (old(key)) map.delete(key)
  }
}

/**
 * Rule 3: a client for another account's sign-in. Its restore does not
 * show the splash. A gone session sends `caribou:session-expired` for this
 * sign-in only.
 */
export function actAsClient(session: BlueskySession): CaribouClient {
  const id = signIn(session)
  let client = clients.get(id)
  if (!client) {
    forgetOldSignIns()
    client = deferredBlueskyClient(session, () => {
      emitSessionExpired({ userKey: session.userKey, generation: session.generation })
    }, { splash: false })
    clients.set(id, client)
  }
  return client
}

type Found = { session: BlueskySession } | { result: ActAsResult }

// The other account's session, as stored now. Rule 5: an expired one sends
// nothing. The active account acts through `mutations.ts`, not here.
function find(userKey: UserKey): Found {
  const s = users.peek().get(userKey)
  if (!s || !isBlueskySession(s) || userKey === activeUserKey.peek()) {
    return { result: { kind: 'failed', message: 'This account is not signed in here.' } }
  }
  if (s.expired) return { result: { kind: 'expired' } }
  return { session: s }
}

// Rule 5: after an await, the answer counts only for the same sign-in, not
// expired. Null: it counts.
function voided(session: BlueskySession): ActAsResult | null {
  const now = users.peek().get(session.userKey)
  if (!now || now.generation !== session.generation) {
    return { kind: 'failed', message: `@${userName(session)} signed in again. Try again.` }
  }
  return now.expired ? { kind: 'expired' } : null
}

function gone(err: unknown): boolean {
  return err instanceof CaribouError && err.code === 'unauthorized'
}

function viewOf(post: Status): ActAsView {
  return {
    favourited: post.favourited === true,
    reblogged: post.reblogged === true,
    bookmarked: post.bookmarked === true,
    likeUri: post.bluesky?.likeUri ?? null,
    repostUri: post.bluesky?.repostUri ?? null,
  }
}

// Rule 8: the kept answers that win over a read that started at `started`.
function withKept(view: ActAsView, prefix: string, started: number): ActAsView {
  const out = { ...view }
  for (const action of Object.keys(SPECS) as StatusAction[]) {
    const k = kept.get(`${prefix} ${action}`)
    if (!k) continue
    const { flag, record } = SPECS[action]
    const disagrees = out[flag] !== k.on || (record !== null && out[record] !== k.record)
    if (started < k.seq || (disagrees && Date.now() - k.at < k.lagMs)) {
      out[flag] = k.on
      if (record) out[record] = k.record
    }
  }
  return out
}

/**
 * Rule 4: reads `status` as the account `userKey` and answers its view,
 * with the writes it acked (rule 8). Nothing is cached.
 */
export async function readAsAccount(userKey: UserKey, status: Status): Promise<ActAsResult> {
  const found = find(userKey)
  if ('result' in found) return found.result
  const session = found.session
  const post = status.reblog ?? status
  const prefix = `${signIn(session)} ${post.id}`
  try {
    const client = actAsClient(session)
    await Promise.allSettled([...writing.get(prefix) ?? []])
    const started = seq
    const copy = await client.fetchStatus(post.id)
    const void_ = voided(session)
    if (void_) return void_
    return { kind: 'ok', view: withKept(viewOf(copy), prefix, started) }
  } catch (err) {
    if (gone(err)) return { kind: 'expired' }
    return voided(session) ?? { kind: 'failed', message: `Could not load this post as @${userName(session)}.` }
  }
}

/**
 * Turns `action` on or off for `status` as the account `userKey`, from its
 * `view` (rules 2 to 8). The active reader's cache does not change.
 */
export async function actAs(userKey: UserKey, action: StatusAction, status: Status, view: ActAsView): Promise<ActAsResult> {
  const post = status.reblog ?? status
  const b = post.bluesky
  if (!b) return { kind: 'failed', message: 'This post cannot be acted on as another account yet.' }
  const key = `act-as:${userKey}:${action}:${post.id}`
  if (inflight.has(key)) return { kind: 'busy' }
  const found = find(userKey)
  if ('result' in found) return found.result
  const session = found.session
  const spec = SPECS[action]
  const wasOn = view[spec.flag]
  // Rule 2: the post's AT URI and CID as is; the record refs are the other
  // account's.
  const ref = { id: post.id, bluesky: { uri: b.uri, cid: b.cid, likeUri: view.likeUri, repostUri: view.repostUri } }
  const prefix = `${signIn(session)} ${post.id}`
  const client = actAsClient(session)
  inflight.add(key)
  const run = client[wasOn ? spec.off : spec.on](ref)
  const out = writing.get(prefix) ?? new Set<Promise<unknown>>()
  out.add(run)
  writing.set(prefix, out)
  try {
    const fresh = await run
    const void_ = voided(session)
    if (void_) return void_
    const on = isWriteAck(fresh) ? fresh.on : fresh[spec.flag] === true
    const record = !spec.record ? null
      : isWriteAck(fresh) ? fresh.record : fresh.bluesky?.[spec.record] ?? null
    seq += 1
    kept.set(`${prefix} ${action}`, { on, record, seq, at: Date.now(), lagMs: client.capabilities?.readLagMs ?? 0 })
    return { kind: 'ok', view: { ...view, [spec.flag]: on, ...(spec.record ? { [spec.record]: record } : {}) } }
  } catch (err) {
    if (gone(err)) return { kind: 'expired' }
    return voided(session) ?? { kind: 'failed', message: `Could not ${spec.verb[wasOn ? 1 : 0]} this post as @${userName(session)}. Try again.` }
  } finally {
    inflight.delete(key)
    out.delete(run)
    if (out.size === 0 && writing.get(prefix) === out) writing.delete(prefix)
  }
}
