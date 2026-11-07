import type { AppBskyFeedDefs } from '@atproto/api'
import type { Status } from '@beatzball/caribou-mastodon-client'
import type { MapContext } from './context.js'

/**
 * One post view → a Caribou `Status` (spec 6.5). Calls `mapEmbed` for the
 * media, card and quote. Moderation comes from `ctx.moderatePost`.
 */
export function mapPost(_view: AppBskyFeedDefs.PostView, _ctx: MapContext): Status {
  throw new Error('TODO(#177): mapPost')
}
