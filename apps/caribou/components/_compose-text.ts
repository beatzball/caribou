import type { mastodon } from 'masto'

// Mastodon counts every link as 23 characters, whatever its length, and a
// remote mention `@alice@example.social` as just `@alice`. Counting the same
// way keeps the counter in step with what the server will accept.
export const URL_LENGTH = 23

const URL_RE = /https?:\/\/[^\s<>"]+/gi
const MENTION_RE = /(^|[^/\w])@(\w+)@[a-z0-9.-]+[a-z0-9]/gi
// Punctuation right after a link ends the sentence, not the link.
const TRAILING_RE = /[.,!?:;'"]+$/

// The part of a matched URL that Mastodon links: no trailing punctuation,
// and no `)` that closes a parenthesis opened before the link.
function linkedPart(url: string): string {
  let out = url
  for (;;) {
    const before = out
    out = out.replace(TRAILING_RE, '')
    if (out.endsWith(')')) {
      const opens = out.split('(').length - 1
      const closes = out.split(')').length - 1
      if (closes > opens) out = out.slice(0, -1)
    }
    if (out === before) return out
  }
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null

// Grapheme clusters, as Mastodon counts: a family emoji or a flag is one
// character, though it is several code points.
function graphemes(s: string): number {
  if (!segmenter) return [...s].length
  let n = 0
  for (const _ of segmenter.segment(s)) n += 1
  return n
}

export function countChars(text: string, spoilerText = ''): number {
  const body = text
    .replace(MENTION_RE, (_m, pre: string, user: string) => `${pre}@${user}`)
    .replace(URL_RE, (url) => {
      const linked = linkedPart(url)
      return 'x'.repeat(URL_LENGTH) + url.slice(linked.length)
    })
  return graphemes(body) + graphemes(spoilerText)
}

// The text a reply starts with: the author, then everyone the post
// mentions, without the person replying and without repeats.
export function replyMentions(status: mastodon.v1.Status, selfAcct: string | null): string {
  const self = selfAcct?.toLowerCase() ?? null
  const seen = new Set<string>()
  const out: string[] = []
  for (const acct of [status.account.acct, ...status.mentions.map((m) => m.acct)]) {
    const key = acct.toLowerCase()
    if (key === self || seen.has(key)) continue
    seen.add(key)
    out.push(`@${acct}`)
  }
  return out.length > 0 ? `${out.join(' ')} ` : ''
}

const VISIBILITY_RANK: Record<mastodon.v1.StatusVisibility, number> = {
  public: 0, unlisted: 1, private: 2, direct: 3,
}

// A reply is never more public than the post it answers.
export function replyVisibility(
  parent: mastodon.v1.StatusVisibility,
  fallback: mastodon.v1.StatusVisibility,
): mastodon.v1.StatusVisibility {
  return VISIBILITY_RANK[parent] >= VISIBILITY_RANK[fallback] ? parent : fallback
}

// Status content is HTML from another server. The preview shows it as text
// only, so nothing in it is ever parsed into the live document.
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.querySelectorAll('script, style')) el.remove()
  for (const br of doc.querySelectorAll('br')) br.replaceWith('\n')
  for (const p of doc.querySelectorAll('p')) p.append('\n')
  return (doc.body.textContent ?? '').trim()
}
