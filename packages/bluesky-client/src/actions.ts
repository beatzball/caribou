import type { Agent } from '@atproto/api'
import {
  CaribouError,
  type AccountRef, type CaribouClient, type RelationshipWriteAck, type StatusRef, type StatusWriteAck,
} from '@beatzball/caribou-mastodon-client'
import { parseAtUri } from './map/post.js'

// The rules are in the README, "Actions (#188)".

const LIKE = 'app.bsky.feed.like'
const REPOST = 'app.bsky.feed.repost'
const FOLLOW = 'app.bsky.graph.follow'
const BLOCK = 'app.bsky.graph.block'

/** The parts of a signed-in `Agent` the actions call. */
export type BlueskyActionsAgent = Pick<Agent, 'did' | 'getPosts' | 'getProfile'> & {
  com: { atproto: { repo: Pick<Agent['com']['atproto']['repo'], 'createRecord' | 'deleteRecord' | 'getRecord'> } }
  app: {
    bsky: {
      bookmark: Pick<Agent['app']['bsky']['bookmark'], 'createBookmark' | 'deleteBookmark'>
      graph: Pick<Agent['app']['bsky']['graph'], 'muteActor' | 'unmuteActor'>
    }
  }
}

type ActionMethods = Pick<CaribouClient,
  | 'favourite' | 'unfavourite' | 'reblog' | 'unreblog' | 'bookmark' | 'unbookmark'
  | 'follow' | 'unfollow' | 'mute' | 'unmute' | 'block' | 'unblock'>

type Write = <T>(fn: () => Promise<T>) => Promise<T>

const LIST_BLOCK = 'This block comes from a list. Remove the account from the list, or unsubscribe from it.'
const LIST_MUTE = 'This mute comes from a list. Remove the account from the list, or unsubscribe from it.'

// A refusal the reader can act on: `userMessage` is what the toast says.
function listRefusal(message: string): CaribouError {
  return Object.assign(new CaribouError('unknown', `Bluesky: ${message}`), { userMessage: message })
}

function isRecordMissing(err: unknown): boolean {
  return (err as { error?: unknown } | null)?.error === 'RecordNotFound'
}

/**
 * The Bluesky writes for the card and profile actions. Each answers an ack
 * (no post, no relationship): what the write left. `write` normalizes
 * errors and never shares a request.
 */
export function createActions(agent: BlueskyActionsAgent, write: Write, nextRkey?: () => string): ActionMethods {
  // The rkey of a write whose answer did not arrive, by collection and
  // subject. The next write of the same intent checks for that record
  // first and reuses the rkey, so a lost answer never makes two records.
  const unanswered = new Map<string, string>()

  function did(): string {
    if (!agent.did) throw new CaribouError('unauthorized', 'no active session')
    return agent.did
  }

  function post(ref: StatusRef): { uri: string; cid: string } {
    const b = ref.bluesky
    if (!b?.uri || !b.cid) throw new CaribouError('not_found', 'Bluesky: this post has no AT URI and CID to act on')
    return { uri: b.uri, cid: b.cid }
  }

  async function create(collection: string, subject: string, record: Record<string, unknown>): Promise<string> {
    const repo = did()
    const intent = `${collection} ${subject}`
    const kept = unanswered.get(intent)
    if (kept) {
      try {
        const { data } = await agent.com.atproto.repo.getRecord({ repo, collection, rkey: kept })
        unanswered.delete(intent)
        return data.uri
      } catch (err) {
        // Any other failure leaves the outcome unknown: write nothing.
        if (!isRecordMissing(err)) throw err
      }
    }
    const rkey = kept ?? nextRkey?.()
    if (rkey) unanswered.set(intent, rkey)
    const { data } = await agent.com.atproto.repo.createRecord({
      repo, collection, ...(rkey ? { rkey } : {}),
      record: { $type: collection, ...record, createdAt: new Date().toISOString() },
    })
    unanswered.delete(intent)
    return data.uri
  }

  // Deletes a record the reader made. The URI must name the reader's own
  // repo and the action's collection: an undo never deletes a guessed or
  // foreign record.
  async function remove(uri: string, collection: string): Promise<void> {
    const parts = parseAtUri(uri)
    if (!parts || parts.did !== did() || parts.collection !== collection) {
      throw new CaribouError('unknown', `Bluesky: ${uri} is not the reader's ${collection} record`)
    }
    await agent.com.atproto.repo.deleteRecord({ repo: parts.did, collection, rkey: parts.rkey })
  }

  // The record an undo deletes. The ref has it when the cache knew it;
  // otherwise the reader's own view of the post (or profile) is read now.
  async function postRecord(ref: StatusRef, field: 'like' | 'repost'): Promise<string | null> {
    const known = field === 'like' ? ref.bluesky?.likeUri : ref.bluesky?.repostUri
    if (known) return known
    const { uri } = post(ref)
    const { data } = await agent.getPosts({ uris: [uri] })
    const view = data.posts.find((p) => p.uri === uri)
    if (!view) throw new CaribouError('not_found', 'Bluesky: the post is gone', { status: 404 })
    return view.viewer?.[field] ?? null
  }

  async function profileRecord(ref: AccountRef, field: 'following' | 'blocking'): Promise<string | null> {
    const known = field === 'following' ? ref.bluesky?.followUri : ref.bluesky?.blockUri
    // An unblock also needs to know whether a list blocks the account.
    const listKnown = field === 'following' || ref.bluesky?.blockingByList !== undefined
    if (field === 'blocking' && ref.bluesky?.blockingByList) throw listRefusal(LIST_BLOCK)
    if (known && listKnown) return known
    const { data } = await agent.getProfile({ actor: ref.id })
    if (field === 'blocking' && data.viewer?.blockingByList) throw listRefusal(LIST_BLOCK)
    return known || (data.viewer?.[field] ?? null)
  }

  const status = (ref: StatusRef, on: boolean, record: string | null): StatusWriteAck =>
    ({ ack: true, id: ref.id, on, record })

  // Undo: delete the record the read found. None found: the post is
  // already as asked, and the ack says so.
  async function undoPost(ref: StatusRef, field: 'like' | 'repost', collection: string): Promise<StatusWriteAck> {
    return write(async () => {
      const uri = await postRecord(ref, field)
      if (uri) await remove(uri, collection)
      return status(ref, false, null)
    })
  }

  async function undoProfile(
    ref: AccountRef, field: 'following' | 'blocking', collection: string,
    ack: (ref: AccountRef) => RelationshipWriteAck,
  ): Promise<RelationshipWriteAck> {
    return write(async () => {
      const uri = await profileRecord(ref, field)
      if (uri) await remove(uri, collection)
      return ack(ref)
    })
  }

  return {
    favourite: (ref) => write(async () => status(ref, true, await create(LIKE, post(ref).uri, { subject: post(ref) }))),
    unfavourite: (ref) => undoPost(ref, 'like', LIKE),
    reblog: (ref) => write(async () => status(ref, true, await create(REPOST, post(ref).uri, { subject: post(ref) }))),
    unreblog: (ref) => undoPost(ref, 'repost', REPOST),
    // A bookmark is private and has no record: only the flag.
    bookmark: (ref) => write(async () => {
      await agent.app.bsky.bookmark.createBookmark(post(ref))
      return status(ref, true, null)
    }),
    unbookmark: (ref) => write(async () => {
      await agent.app.bsky.bookmark.deleteBookmark({ uri: post(ref).uri })
      return status(ref, false, null)
    }),

    follow: (ref) => write(async () => {
      const followUri = await create(FOLLOW, ref.id, { subject: ref.id })
      return { ack: true, id: ref.id, flags: { following: true }, bluesky: { followUri } }
    }),
    unfollow: (ref) => undoProfile(ref, 'following', FOLLOW,
      (r) => ({ ack: true, id: r.id, flags: { following: false }, bluesky: { followUri: null } })),
    // A mute is private and has no record. It hides notifications too.
    mute: (ref) => write(async () => {
      await agent.app.bsky.graph.muteActor({ actor: ref.id })
      return { ack: true, id: ref.id, flags: { muting: true, mutingNotifications: true } }
    }),
    // A list's mute is not the reader's to remove here (state README, A3).
    unmute: (ref) => write(async () => {
      let list = ref.bluesky?.mutingByList
      if (list === undefined) list = (await agent.getProfile({ actor: ref.id })).data.viewer?.mutedByList?.uri ?? null
      if (list) throw listRefusal(LIST_MUTE)
      await agent.app.bsky.graph.unmuteActor({ actor: ref.id })
      return { ack: true, id: ref.id, flags: { muting: false, mutingNotifications: false } }
    }),
    // A block is a public record. It leaves the reader's follow record alone.
    // An unblock refuses a list's block (state README, A3).
    block: (ref) => write(async () => {
      const blockUri = await create(BLOCK, ref.id, { subject: ref.id })
      return { ack: true, id: ref.id, flags: { blocking: true }, bluesky: { blockUri } }
    }),
    unblock: (ref) => undoProfile(ref, 'blocking', BLOCK,
      (r) => ({ ack: true, id: r.id, flags: { blocking: false }, bluesky: { blockUri: null } })),
  }
}
