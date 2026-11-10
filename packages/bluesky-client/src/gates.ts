/**
 * Reply and quote limits for a new post (#199): the thread gate and post
 * gate records, and the `applyWrites` that writes them with the post. Plain
 * data; no SDK import. Rules: README, "Compose", and `packages/state`
 * README, "Reply and quote limits".
 */
import type { BlueskyGates, BlueskyPostRecord, BlueskyReplyRule } from '@beatzball/caribou-mastodon-client'

const POST = 'app.bsky.feed.post'
const THREADGATE = 'app.bsky.feed.threadgate'
const POSTGATE = 'app.bsky.feed.postgate'
const CREATE = 'com.atproto.repo.applyWrites#create'

/** True when the limits write nothing: everyone can reply, quotes on. */
export function noGates(g: BlueskyGates | null | undefined): boolean {
  return !g || (g.replies === null && g.quotes)
}

function allowRule(r: BlueskyReplyRule, listUri: (id: string) => string): Record<string, unknown> {
  switch (r.kind) {
    case 'mention': return { $type: `${THREADGATE}#mentionRule` }
    case 'following': return { $type: `${THREADGATE}#followingRule` }
    case 'follower': return { $type: `${THREADGATE}#followerRule` }
    case 'list': return { $type: `${THREADGATE}#listRule`, list: listUri(r.id) }
  }
}

export interface GateWrite {
  $type: typeof CREATE
  collection: string
  rkey: string
  value: Record<string, unknown>
}

/**
 * The writes of one `applyWrites`: the post, then its thread gate (replies
 * limited), then its post gate (quotes off). One rkey; the gates take the
 * post's `createdAt`. `listUri` makes a list's URI in the reader's repo and
 * refuses an id that is not a record key, so only an own list is named.
 */
export function gatedPostWrites(
  did: string, rkey: string, record: BlueskyPostRecord, g: BlueskyGates, listUri: (id: string) => string,
): GateWrite[] {
  const post = `at://${did}/${POST}/${rkey}`
  const write = (collection: string, value: Record<string, unknown>): GateWrite => ({ $type: CREATE, collection, rkey, value })
  const out = [write(POST, record as unknown as Record<string, unknown>)]
  if (g.replies !== null) {
    out.push(write(THREADGATE, { $type: THREADGATE, post, createdAt: record.createdAt, allow: g.replies.map((r) => allowRule(r, listUri)) }))
  }
  if (!g.quotes) {
    out.push(write(POSTGATE, {
      $type: POSTGATE, post, createdAt: record.createdAt,
      embeddingRules: [{ $type: `${POSTGATE}#disableRule` }],
    }))
  }
  return out
}
