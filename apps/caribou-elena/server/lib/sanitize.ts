import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'

const purify = DOMPurify(new JSDOM('').window as unknown as Parameters<typeof DOMPurify>[0])

export function sanitize(html: string): string {
  return purify.sanitize(html, PURIFY_OPTS) as unknown as string
}
