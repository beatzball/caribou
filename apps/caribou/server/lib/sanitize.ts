import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import { sanitizeAccountWith, sanitizeStatusWith } from '../../components/_sanitize-shape.js'

const purify = DOMPurify(new JSDOM('').window as unknown as Parameters<typeof DOMPurify>[0])
installPurifyHooks(purify)

export function sanitize(html: string): string {
  return purify.sanitize(html, PURIFY_OPTS) as unknown as string
}

// The two shapes every page fetcher sanitizes before it hands data to the
// renderer. The server renders `content` and `note` as HTML, and the browser
// hydrates against that exact markup, so each field is cleaned once, here.
// Which fields: `components/_sanitize-shape.ts`, shared with the browser.
//
// Load this module with a dynamic `import()` inside `pageData` — a static
// import would pull jsdom into the client bundle.

export function sanitizeStatus<T extends Parameters<typeof sanitizeStatusWith>[0]>(status: T): T {
  return sanitizeStatusWith(status, sanitize)
}

export function sanitizeAccount<T extends { note?: string | null }>(account: T): T {
  return sanitizeAccountWith(account, sanitize)
}
