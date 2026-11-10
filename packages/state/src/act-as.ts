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

/** Tests only: forget the clients made. */
export function _testOnlyResetActAs(): void {
  clients.clear()
}

/**
 * Rule 3: a client for another account's sign-in. Its restore does not
 * show the splash. A gone session sends `caribou:session-expired` for this
 * sign-in only.
 */
export function actAsClient(session: BlueskySession): CaribouClient {
  const id = `${session.userKey} ${session.generation}`
  let client = clients.get(id)
  if (!client) {
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

/**
 * Rule 4: reads `status` as the account `userKey` and answers its view.
 * Nothing is cached.
 */
export async function readAsAccount(userKey: UserKey, status: Status): Promise<ActAsResult> {
  const found = find(userKey)
  if ('result' in found) return found.result
  const post = status.reblog ?? status
  try {
    return { kind: 'ok', view: viewOf(await actAsClient(found.session).fetchStatus(post.id)) }
  } catch (err) {
    if (gone(err)) return { kind: 'expired' }
    return { kind: 'failed', message: `Could not load this post as @${userName(found.session)}.` }
  }
}

/**
 * Turns `action` on or off for `status` as the account `userKey`, from its
 * `view` (rules 2 to 7). The active reader's cache does not change.
 */
export async function actAs(userKey: UserKey, action: StatusAction, status: Status, view: ActAsView): Promise<ActAsResult> {
  const post = status.reblog ?? status
  const b = post.bluesky
  if (!b) return { kind: 'failed', message: 'This post cannot be acted on as another account yet.' }
  const key = `act-as:${userKey}:${action}:${post.id}`
  if (inflight.has(key)) return { kind: 'busy' }
  const found = find(userKey)
  if ('result' in found) return found.result
  const spec = SPECS[action]
  const wasOn = view[spec.flag]
  // Rule 2: the post's AT URI and CID as is; the record refs are the other
  // account's.
  const ref = { id: post.id, bluesky: { uri: b.uri, cid: b.cid, likeUri: view.likeUri, repostUri: view.repostUri } }
  inflight.add(key)
  try {
    const client = actAsClient(found.session)
    const fresh = await client[wasOn ? spec.off : spec.on](ref)
    const on = isWriteAck(fresh) ? fresh.on : fresh[spec.flag] === true
    const record = !spec.record ? undefined
      : isWriteAck(fresh) ? fresh.record : fresh.bluesky?.[spec.record] ?? null
    return { kind: 'ok', view: { ...view, [spec.flag]: on, ...(spec.record ? { [spec.record]: record } : {}) } }
  } catch (err) {
    if (gone(err)) return { kind: 'expired' }
    return { kind: 'failed', message: `Could not ${spec.verb[wasOn ? 1 : 0]} this post as @${userName(found.session)}. Try again.` }
  } finally {
    inflight.delete(key)
  }
}
