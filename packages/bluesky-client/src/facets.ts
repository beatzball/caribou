import type { AppBskyRichtextFacet } from '@atproto/api'

/**
 * Post text plus facets → HTML (spec 7.1). Byte offsets, http(s) links only,
 * mentions by DID, tags to `/tags/<tag>?net=bsky`, wrapped in `<p>`. Pure and
 * server-safe; the caller still runs `PURIFY_OPTS` over the result.
 */
export function renderFacets(_text: string, _facets: AppBskyRichtextFacet.Main[] | undefined): string {
  throw new Error('TODO(#178): renderFacets')
}
