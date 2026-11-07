import type { AppBskyFeedDefs } from '@atproto/api'
import type { MediaAttachment, PreviewCard, Quote } from '@beatzball/caribou-mastodon-client'
import type { MapContext } from './map/context.js'

/** The parts of a `Status` that come from a post's embed (spec 6.5 and 7.3). */
export interface EmbedParts {
  mediaAttachments: MediaAttachment[]
  card: PreviewCard | null
  quote: Quote | null
}

/**
 * A post's embed view → media, card and quote. An unknown `$type` becomes a
 * "Not supported here — open on bsky.app" card; it never throws. `ctx` maps a
 * quoted post the same way `mapPost` maps the outer one.
 */
export function mapEmbed(_embed: AppBskyFeedDefs.PostView['embed'], _ctx: MapContext): EmbedParts {
  throw new Error('TODO(#179): mapEmbed')
}
