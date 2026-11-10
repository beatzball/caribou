// Caribou's own page for a hashtag. A hashtag link in a post opens it, and
// the page reads its name back from the path.

/** The in-app path for a hashtag. The name keeps the case the post used. */
export function tagPath(name: string): string {
  return `/tags/${encodeURIComponent(name)}`
}

// Mastodon's `Tag::HASHTAG_NAME_RE` (app/models/tag.rb), in JavaScript.
// Ruby's `[[:word:]]` is Alphabetic, a mark, a decimal digit or connector
// punctuation; `[[:alpha:]]` is Alphabetic.
const WORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}'
const ALPHA = '\\p{Alphabetic}'
const SEPARATORS = '_\\u00B7\\u30FB\\u200C'
const FIRST = `[${WORD}_][${WORD}${SEPARATORS}]*[${ALPHA}${SEPARATORS}][${WORD}${SEPARATORS}]*[${WORD}_]`
const LAST = `[${WORD}_]*[${ALPHA}][${WORD}_]*`
const TAG_NAME = new RegExp(`^(?:${FIRST}|${LAST})$`, 'u')
const MAX_LENGTH = 200

/**
 * The hashtag a `/tags/:tag` path segment names, or null when it cannot be
 * one. The segment comes percent-encoded. One leading `#` is dropped, and
 * the name is composed (NFC) so a decomposed accent names the same tag.
 */
export function parseTagParam(raw: string): string | null {
  let name: string
  try {
    name = decodeURIComponent(raw)
  } catch {
    return null
  }
  name = name.replace(/^#/, '').normalize('NFC')
  if (name.length === 0 || name.length > MAX_LENGTH) return null
  if (!TAG_NAME.test(name)) return null
  return name
}

/**
 * Where a Bluesky reader on the Mastodon tag page goes: the Bluesky tag
 * page for the same tag (`/tags/<tag>?net=bsky`). Null when the reader is
 * not on Bluesky, or is already there. An older Mastodon page's `max_id`
 * means nothing to Bluesky, so it is dropped.
 */
export function blueskyTagRedirect(pathname: string, search: string, network: string | null): string | null {
  if (network !== 'bluesky') return null
  const m = /^\/tags\/([^/]+)$/.exec(pathname)
  if (!m) return null
  if (new URLSearchParams(search).get('net') === 'bsky') return null
  return `/tags/${m[1]}?net=bsky`
}
