// Which fields of a post and an account hold HTML, and how to clean them
// with a given sanitizer. One copy: the server cleans page data with its
// jsdom DOMPurify (`server/lib/sanitize.ts`); the browser's Bluesky
// fallback (`_bluesky-public.ts`) cleans with the browser's DOMPurify.

interface PostLike {
  content?: string | null
  // A quote (Mastodon 4.5) carries the quoted post, which the page renders
  // too. A shallow quote has only an id, and no content to clean.
  quote?: { state: string; quotedStatus?: { content?: string | null } | null } | null
}

interface StatusLike extends PostLike {
  reblog?: PostLike | null
}

type Sanitize = (html: string) => string

function cleanPost<T extends PostLike>(post: T, sanitize: Sanitize): T {
  const quoted = post.quote && 'quotedStatus' in post.quote ? post.quote.quotedStatus : null
  return {
    ...post,
    content: sanitize(post.content ?? ''),
    ...(quoted
      ? { quote: { ...post.quote, quotedStatus: { ...quoted, content: sanitize(quoted.content ?? '') } } }
      : {}),
  }
}

export function sanitizeStatusWith<T extends StatusLike>(status: T, sanitize: Sanitize): T {
  return {
    ...cleanPost(status, sanitize),
    ...(status.reblog ? { reblog: cleanPost(status.reblog, sanitize) } : {}),
  }
}

export function sanitizeAccountWith<T extends { note?: string | null }>(account: T, sanitize: Sanitize): T {
  return { ...account, note: sanitize(account.note ?? '') }
}
