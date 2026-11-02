// Caribou's own page for a hashtag. A hashtag link in a post opens it, and
// the page reads its name back from the path.

/** The in-app path for a hashtag. The name keeps the case the post used. */
export function tagPath(name: string): string {
  return `/tags/${encodeURIComponent(name)}`
}

// Mastodon's rule, roughly: letters, marks, digits, `_`, the middle dot and
// the zero-width non-joiner, with at least one letter. Anything else is not
// a hashtag the server could have.
const TAG_NAME = /^[\p{L}\p{M}\p{N}_·‌]+$/u
const HAS_LETTER = /\p{L}/u
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
  if (!TAG_NAME.test(name) || !HAS_LETTER.test(name)) return null
  return name
}
