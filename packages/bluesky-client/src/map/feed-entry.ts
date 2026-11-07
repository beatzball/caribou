import type { AppBskyFeedDefs } from '@atproto/api'
import type { Status } from '@beatzball/caribou-mastodon-client'
import type { MapContext } from './context.js'

/**
 * A feed entry's identity (spec 6.3, seam 8). A plain post is its post URI.
 * A repost is `reason.uri`, or `repost:<by.did>:<post.uri>:<reason.indexedAt>`
 * when the AppView leaves `uri` out.
 */
export function feedEntryId(_entry: AppBskyFeedDefs.FeedViewPost): string {
  throw new Error('TODO(#177): feedEntryId')
}

/** A feed entry → a `Status`. A repost becomes a wrapper whose `reblog` is the post. */
export function mapFeedEntry(_entry: AppBskyFeedDefs.FeedViewPost, _ctx: MapContext): Status {
  throw new Error('TODO(#177): mapFeedEntry')
}
