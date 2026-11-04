import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'

const purify = DOMPurify(new JSDOM('').window as unknown as Parameters<typeof DOMPurify>[0])
installPurifyHooks(purify)

export function sanitize(html: string): string {
  return purify.sanitize(html, PURIFY_OPTS) as unknown as string
}

// The two shapes every page fetcher sanitizes before it hands data to the
// renderer. The server renders `content` and `note` as HTML, and the browser
// hydrates against that exact markup, so each field is cleaned once, here.
//
// Load this module with a dynamic `import()` inside `pageData` — a static
// import would pull jsdom into the client bundle.

interface PostLike {
  content?: string | null
  // A quote (Mastodon 4.5) carries the quoted post, which the server
  // renders too. A shallow quote has only an id, and no content to clean.
  quote?: { state: string; quotedStatus?: { content?: string | null } | null } | null
}

interface StatusLike extends PostLike {
  reblog?: PostLike | null
}

function cleanPost<T extends PostLike>(post: T): T {
  const quoted = post.quote && 'quotedStatus' in post.quote ? post.quote.quotedStatus : null
  return {
    ...post,
    content: sanitize(post.content ?? ''),
    ...(quoted
      ? { quote: { ...post.quote, quotedStatus: { ...quoted, content: sanitize(quoted.content ?? '') } } }
      : {}),
  }
}

export function sanitizeStatus<T extends StatusLike>(status: T): T {
  return {
    ...cleanPost(status),
    ...(status.reblog ? { reblog: cleanPost(status.reblog) } : {}),
  }
}

export function sanitizeAccount<T extends { note?: string | null }>(account: T): T {
  return { ...account, note: sanitize(account.note ?? '') }
}
