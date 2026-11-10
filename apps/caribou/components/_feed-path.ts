// Addresses for Bluesky feeds (#194). Home is Following; each custom feed is
// a Home tab with its own address, so Back and Forward keep each tab's place.

// A feed generator's AT URI: `at://<did>/app.bsky.feed.generator/<rkey>`.
const FEED_URI = /^at:\/\/did:[a-z0-9]+:[^/]+\/app\.bsky\.feed\.generator\/([^/]+)$/i

/** Whether `uri` names a feed generator. */
export function isFeedUri(uri: string): boolean {
  return FEED_URI.test(uri)
}

/** The rkey of a feed URI: its name when nothing better is known. */
export function feedRkey(uri: string): string {
  return FEED_URI.exec(uri)?.[1] ?? uri
}

/** The Home tab of a feed; '' (Following) is `/home`. */
export function feedPath(uri: string): string {
  return uri ? `/home?feed=${encodeURIComponent(uri)}` : '/home'
}

/** The feed a Home address names, or '' for Following. */
export function feedFromSearch(search: string): string {
  return new URLSearchParams(search).get('feed') ?? ''
}
