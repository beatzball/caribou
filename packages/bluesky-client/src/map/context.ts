import type { AppBskyFeedDefs } from '@atproto/api'
import type { BlueskyModerationResult, StatusBluesky } from '@beatzball/caribou-mastodon-client'

/**
 * What a mapper needs besides the view. The caller owns both parts: the
 * mappers never run moderation themselves (that needs the SDK and the
 * reader's prefs, `../moderation.ts`), so they stay server-safe.
 */
export interface MapContext {
  /** The UserKey whose viewer state the view carries, or null for a public fetch. */
  viewerOf: StatusBluesky['viewerOf']
  /** Moderation for one post, already plain data. Called once per post, quotes included. */
  moderatePost(view: AppBskyFeedDefs.PostView): BlueskyModerationResult
}
