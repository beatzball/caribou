import type { AccountRef, Relationship, RelationshipWriteAck, Status, StatusRef, StatusWriteAck } from './types.js'

/** The ref a status action sends for this post. A Mastodon post gives only its id. */
export function statusRef(status: Pick<Status, 'id' | 'bluesky'>): StatusRef {
  const b = status.bluesky
  if (!b) return { id: status.id }
  return { id: status.id, bluesky: { uri: b.uri, cid: b.cid, likeUri: b.likeUri, repostUri: b.repostUri } }
}

/**
 * The ref a follow, mute or block sends for this account. The record refs
 * come from the relationship as last known; a Mastodon relationship has none.
 */
export function accountRef(
  accountId: string, relationship?: Pick<Relationship, 'bluesky'>,
): AccountRef {
  const b = relationship?.bluesky
  if (!b) return { id: accountId }
  return { id: accountId, bluesky: { followUri: b.followUri, blockUri: b.blockUri } }
}

/** True for a Bluesky write's ack, false for a whole post or relationship. */
export function isWriteAck<T extends object>(
  result: T | StatusWriteAck | RelationshipWriteAck,
): result is StatusWriteAck | RelationshipWriteAck {
  return (result as { ack?: unknown }).ack === true
}
