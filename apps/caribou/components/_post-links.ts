import { normalizeTagName } from '@beatzball/caribou-state'

// Links in a post body are the author's server HTML. These read a plain
// click on one as Caribou's own page: the status card's text and the quoted
// post's text in `<caribou-status-quote>`.

// Compare as parsed URLs: `a.href` is the browser's normalized form of the
// attribute, and `mentions[].url` is the server's raw string.
export function sameUrl(raw: string, href: string): boolean {
  try { return new URL(raw).href === href } catch { return false }
}

// The hashtag a body link stands for, as the post wrote it, or null. Mastodon
// marks one `class="mention hashtag" rel="tag"`; other servers may set only
// `rel="tag"`. The link text is `#name`. It counts only when the post lists
// the tag, compared as Mastodon does (case and Unicode form ignored), so a
// look-alike link in the text cannot open a tag page.
export function hashtagOf(a: HTMLAnchorElement, tags: readonly { name: string }[] | undefined): string | null {
  if (!a.matches('.hashtag') && !a.relList.contains('tag')) return null
  const text = (a.textContent ?? '').trim()
  if (!text.startsWith('#')) return null
  const name = text.slice(1)
  const wanted = normalizeTagName(name)
  if (!name || !tags?.some((t) => normalizeTagName(t.name) === wanted)) return null
  return name
}

// A tag link in a Bluesky post: the facet renderer writes
// `/tags/<tag>?net=bsky` (bluesky-client README, facets). It counts only on
// a Bluesky post that lists the tag, so a look-alike link opens nothing.
const BLUESKY_TAG_HREF = /^\/tags\/([^/?#]+)\?net=bsky$/

/** The in-app path a tag link in a Bluesky post opens, or null. */
export function blueskyTagPathOf(
  a: HTMLAnchorElement,
  post: { tags?: readonly { name: string }[] | undefined; bluesky?: unknown } | null | undefined,
): string | null {
  if (!post?.bluesky) return null
  const href = a.getAttribute('href') ?? ''
  const m = BLUESKY_TAG_HREF.exec(href)
  if (!m) return null
  let name: string
  try { name = decodeURIComponent(m[1]!) } catch { return null }
  const wanted = normalizeTagName(name)
  return post.tags?.some((t) => normalizeTagName(t.name) === wanted) ? href : null
}
