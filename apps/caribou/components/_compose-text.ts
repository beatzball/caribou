import type { mastodon } from 'masto'

// Mastodon counts every link as 23 characters, whatever its length, and a
// remote mention `@alice@example.social` as just `@alice`. Counting the same
// way keeps the counter in step with what the server will accept.
export const URL_LENGTH = 23

const URL_RE = /https?:\/\/[^\s<>"]+/gi
const MENTION_RE = /(^|[^/\w])@(\w+)@[a-z0-9.-]+[a-z0-9]/gi

export function countChars(text: string, spoilerText = ''): number {
  const body = text
    .replace(MENTION_RE, (_m, pre: string, user: string) => `${pre}@${user}`)
    .replace(URL_RE, 'x'.repeat(URL_LENGTH))
  // Code points, not UTF-16 units: an emoji is one character to Mastodon.
  return [...body].length + [...spoilerText].length
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
