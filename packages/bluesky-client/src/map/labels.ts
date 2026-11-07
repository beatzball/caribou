import type { ComAtprotoLabelDefs } from '@atproto/api'
import type { BlueskyLabel } from '@beatzball/caribou-mastodon-client'

/**
 * The AppView's labels → plain `BlueskyLabel`s. Keeps only the fields
 * moderation reads. The signature (`sig`) is bytes: JSON would turn it into
 * an object, so SSR page data would not equal the first client render.
 */
export function mapLabels(labels: readonly ComAtprotoLabelDefs.Label[] | undefined): BlueskyLabel[] {
  return (labels ?? []).map((l) => ({
    src: l.src,
    uri: l.uri,
    ...(l.cid !== undefined ? { cid: l.cid } : {}),
    val: l.val,
    ...(l.neg !== undefined ? { neg: l.neg } : {}),
    cts: l.cts,
  }))
}
