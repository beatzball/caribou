// A list's address: `/lists/<id>`. Mastodon's ids are digits; another
// server's may hold letters, `-` or `_`. Anything else (a `/`, a `.`, a
// space) is refused before it can reach a request path.
const LIST_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The list id a path segment names, or null when it names none. */
export function parseListId(raw: string): string | null {
  let id: string
  try {
    id = decodeURIComponent(raw)
  } catch {
    return null
  }
  return LIST_ID.test(id) ? id : null
}

/** The address of a list's timeline. */
export const listPath = (id: string) => `/lists/${encodeURIComponent(id)}`
