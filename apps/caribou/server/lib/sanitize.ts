import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'

const purify = DOMPurify(new JSDOM('').window as unknown as Parameters<typeof DOMPurify>[0])

export function sanitize(html: string): string {
  return purify.sanitize(html, PURIFY_OPTS) as unknown as string
}

// The two shapes every page fetcher sanitizes before it hands data to the
// renderer. The server renders `content` and `note` as HTML, and the browser
// hydrates against that exact markup, so each field is cleaned once, here.
//
// Load this module with a dynamic `import()` inside `pageData` — a static
// import would pull jsdom into the client bundle.

interface StatusLike {
  content?: string | null
  reblog?: { content?: string | null } | null
}

export function sanitizeStatus<T extends StatusLike>(status: T): T {
  return {
    ...status,
    content: sanitize(status.content ?? ''),
    ...(status.reblog
      ? { reblog: { ...status.reblog, content: sanitize(status.reblog.content ?? '') } }
      : {}),
  }
}

export function sanitizeAccount<T extends { note?: string | null }>(account: T): T {
  return { ...account, note: sanitize(account.note ?? '') }
}
