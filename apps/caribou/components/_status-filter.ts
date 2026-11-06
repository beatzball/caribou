import type { Status } from '@beatzball/caribou-mastodon-client'

// The places a server filter can apply to (Mastodon's filter `context`).
export type FilterContext = 'home' | 'notifications' | 'public' | 'thread' | 'account'

export interface FilterVerdict {
  // `hide` removes the post. `warn` shows the filter names and a Show button.
  action: 'hide' | 'warn'
  titles: string[]
}

// What the reader's own filters say about a post in one context. A server
// that knows filters v2 sends the matches in `filtered`, but it sends every
// match, whatever the context: the client picks the ones for where the post
// is shown. An older server, or a copy fetched without a token, has no
// `filtered`, and nothing changes. A null context (bookmarks) never filters.
//
// `blur` (Mastodon 4.4) and any action this build does not know count as
// warn: the reader asked for the post to be kept out of sight.
export function filterVerdict(
  status: Status, context: FilterContext | null,
): FilterVerdict | null {
  if (!context) return null
  const results = [...(status.filtered ?? []), ...(status.reblog?.filtered ?? [])]
  const hide: string[] = []
  const warn: string[] = []
  for (const r of results) {
    const f = r?.filter
    if (!f || !Array.isArray(f.context) || !f.context.includes(context)) continue
    const list = f.filterAction === 'hide' ? hide : warn
    if (!list.includes(f.title)) list.push(f.title)
  }
  if (hide.length > 0) return { action: 'hide', titles: hide }
  if (warn.length > 0) return { action: 'warn', titles: warn }
  return null
}

/** The filter context of a timeline; null for one that is never filtered. */
export function timelineFilterContext(kind: string): FilterContext | null {
  // Mastodon files list timelines under its home context ("Home and lists").
  if (kind === 'home' || kind === 'list') return 'home'
  // Mastodon files hashtag timelines under its public context.
  if (kind === 'local' || kind === 'public' || kind === 'hashtag') return 'public'
  return null
}
