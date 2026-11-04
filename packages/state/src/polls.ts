import { batch } from '@preact/signals-core'
import type { mastodon } from 'masto'
import { mergeStatus, statusCache } from './caches.js'
import { inflight } from './inflight.js'
import { ownerGeneration } from './keep-alive.js'
import type { MutationOpts } from './mutations.js'
import { activeClient } from './users.js'

type Status = mastodon.v1.Status
type Poll = mastodon.v1.Poll

/**
 * The poll as it looks once the reader's vote is in: their choices marked,
 * one vote more on each, one voter more. Counts the server hides stay
 * hidden.
 */
export function optimisticVote(poll: Poll, choices: readonly number[]): Poll {
  return {
    ...poll,
    voted: true,
    ownVotes: [...choices],
    votesCount: (poll.votesCount ?? 0) + choices.length,
    votersCount: typeof poll.votersCount === 'number' ? poll.votersCount + 1 : poll.votersCount,
    options: poll.options.map((o, i) => choices.includes(i) && typeof o.votesCount === 'number'
      ? { ...o, votesCount: o.votesCount + 1 }
      : o),
  }
}

/** The poll of post `id` as the cache holds it now: alone, or inside a boost. */
export function cachedPoll(id: string): Poll | null {
  const cache = statusCache.value
  const own = cache.get(id)
  if (own?.poll) return own.poll
  for (const s of cache.values()) if (s.reblog?.id === id && s.reblog.poll) return s.reblog.poll
  return null
}

// The poll of post `id`, in the post and in every boost of it, in one write,
// so a list that shows both never shows them out of step. `next` sees each
// copy's poll and returns the one to keep.
function writePoll(id: string, next: (poll: Poll) => Poll): void {
  const cache = statusCache.peek()
  let out: Map<string, Status> | null = null
  const put = (key: string, post: Status, wrap?: Status) => {
    if (!post.poll) return
    const poll = next(post.poll)
    if (poll === post.poll) return
    out ??= new Map(cache)
    const updated = { ...post, poll }
    out.set(key, wrap ? { ...wrap, reblog: updated } : updated)
  }
  const own = cache.get(id)
  if (own) put(id, own)
  for (const [key, s] of cache) if (s.reblog?.id === id) put(key, s.reblog, s)
  if (out) statusCache.value = out
}

const voteKey = (id: string) => `vote:${id}`

// A revision per post, moved by every write a vote makes: its start, its
// result and its rollback. A refresh notes it when it leaves and drops its
// answer when it moved meanwhile, so a read that started before or during a
// vote never overwrites what the vote wrote.
const pollRev = new Map<string, number>()
const bump = (id: string) => { pollRev.set(id, (pollRev.get(id) ?? 0) + 1) }

/**
 * Votes on the poll of `status` (or of the post it boosts) with the indexes
 * of the chosen options. The vote shows at once in every cached copy of the
 * post. On success the server's poll replaces it; on failure it goes back,
 * a toast says so, and the poll is asked for again (the server may hold a
 * vote this page does not know). A second vote while one is out, a vote on
 * an expired poll or one the reader voted on, sends nothing. A result that
 * lands after the account changed writes nothing. Resolves true when the
 * vote went through.
 */
export async function votePoll(status: Status, choices: readonly number[], opts: MutationOpts = {}): Promise<boolean> {
  const target = status.reblog ?? status
  const id = target.id
  if (!target.poll || choices.length === 0) return false
  const key = voteKey(id)
  if (inflight.has(key)) return false
  const client = (opts.clientSource ?? (() => activeClient.value))()
  if (!client) return false
  // The cache may hold a newer copy of the poll than the caller's.
  if (!cachedPoll(id)) mergeStatus(status)
  const before = cachedPoll(id) ?? target.poll
  if (before.id !== target.poll.id || before.expired || before.voted) return false
  if (!before.multiple && choices.length > 1) return false

  const generation = ownerGeneration()
  const optimistic = optimisticVote(before, choices)
  bump(id)
  inflight.add(key)
  writePoll(id, (p) => p.id === before.id ? optimistic : p)
  try {
    const fresh = await client.votePoll(before.id, choices)
    if (generation !== ownerGeneration()) return false
    bump(id)
    writePoll(id, (p) => p.id === fresh.id ? fresh : p)
    return true
  } catch {
    if (generation !== ownerGeneration()) return false
    // Undo only this vote: a copy that no longer holds it was written since
    // from the server.
    bump(id)
    writePoll(id, (p) => p === optimistic ? before : p)
  } finally {
    inflight.delete(key)
  }
  // The server may hold a vote this page did not know (it answers "already
  // voted"). Read the poll again; only when it has no vote is this a failure.
  const now = await refreshPoll(target, opts)
  if (generation === ownerGeneration() && now?.voted !== true) toast('Could not send your vote. Try again.')
  return false
}

/**
 * Asks the server for the poll of `status` again and writes it to every
 * cached copy. Resolves to the poll, or null on failure, while a vote is
 * out, or when the account changed meanwhile.
 */
export async function refreshPoll(status: Status, opts: MutationOpts = {}): Promise<Poll | null> {
  const target = status.reblog ?? status
  const poll = target.poll
  const client = (opts.clientSource ?? (() => activeClient.value))()
  if (!poll || !client) return null
  const generation = ownerGeneration()
  const rev = pollRev.get(target.id) ?? 0
  try {
    const fresh = await client.fetchPoll(poll.id)
    if (generation !== ownerGeneration() || inflight.has(voteKey(target.id))) return null
    if ((pollRev.get(target.id) ?? 0) !== rev) return null
    batch(() => {
      if (!cachedPoll(target.id)) mergeStatus(status)
      writePoll(target.id, (p) => p.id === fresh.id ? fresh : p)
    })
    return fresh
  } catch {
    return null
  }
}

function toast(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'error', message } }))
}
