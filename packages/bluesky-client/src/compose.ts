/**
 * Compose helpers over the SDK (#189, spec 7.2). Browser only: it imports
 * the SDK, so it loads through `./browser`, in the lazy chunk. Rules: the
 * README, "Compose".
 */
import { RichText, type AtpBaseClient } from '@atproto/api'
import { TID } from '@atproto/common-web'
import type { BlueskyFacet } from '@beatzball/caribou-mastodon-client'

/** The `app.bsky.feed.post` lexicon's limits on `text`. */
export const POST_MAX_GRAPHEMES = 300
export const POST_MAX_BYTES = 3000

export interface PostLength {
  /** Graphemes, as the PDS counts them (`RichText.graphemeLength`). */
  graphemes: number
  /** UTF-8 bytes (`RichText.length`). */
  bytes: number
}

/** How long `text` is, counted the way the PDS checks it. */
export function countPost(text: string): PostLength {
  const rt = new RichText({ text })
  return { graphemes: rt.graphemeLength, bytes: rt.length }
}

/** True when `text` fits both limits. */
export function postFits(len: PostLength): boolean {
  return len.graphemes <= POST_MAX_GRAPHEMES && len.bytes <= POST_MAX_BYTES
}

/** A new record key: a TID, as `app.bsky.feed.post` wants. */
export function nextRkey(): string {
  return TID.nextStr()
}

/**
 * The facets of `text` (`RichText.detectFacets`): links, mentions and tags.
 * A mention whose handle does not resolve gets an empty DID from the SDK; the
 * PDS would refuse the whole post for it, so that mention is dropped and its
 * text stays plain.
 */
export async function detectFacets(agent: Pick<AtpBaseClient, 'com'>, text: string): Promise<BlueskyFacet[]> {
  const rt = new RichText({ text })
  await rt.detectFacets(agent as AtpBaseClient)
  const out: BlueskyFacet[] = []
  for (const facet of rt.facets ?? []) {
    const features = facet.features.filter((f) => {
      const did = (f as { did?: unknown }).did
      return f.$type !== 'app.bsky.richtext.facet#mention' || (typeof did === 'string' && did.startsWith('did:'))
    })
    if (features.length > 0) out.push({ index: { ...facet.index }, features: features.map((f) => ({ ...f })) as BlueskyFacet['features'] })
  }
  return out
}
