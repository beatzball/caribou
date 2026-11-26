import type { Account, Status } from '@beatzball/caribou-mastodon-client'

// Shared by the document head and the client lifecycle. Return plain text;
// only the server's HTML boundary escapes it.
const ROUTE_NAMES: Record<string, string> = {
  '/': 'Welcome', '/home': 'Home', '/local': 'Local', '/public': 'Public',
  '/notifications': 'Notifications', '/search': 'Search', '/feeds': 'Feeds',
  '/lists': 'Lists', '/bookmarks': 'Bookmarks', '/settings': 'Settings',
  '/settings/moderation': 'Moderation settings', '/about': 'About',
  '/privacy': 'Privacy', '/changelog': 'Changelog', '/blog': 'Blog',
  '/signin/bluesky': 'Sign in with Bluesky',
}

function decode(segment: string): string {
  try { return decodeURIComponent(segment) } catch { return segment }
}

export function routeTitle(url: URL, visibleName?: string | null): string {
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const parts = path.split('/')
  let name = ROUTE_NAMES[path]
  if (path === '/search') {
    const q = url.searchParams.get('q')?.trim()
    if (q) name = `Search: ${q}`
  } else if (parts[1] === 'tags' && parts[2]) {
    name = `#${decode(parts.slice(2).join('/'))}`
  } else if (parts[1] === 'blog' && parts[2]) {
    name = `Post: ${decode(parts[2])}`
  } else if (parts[1]?.startsWith('@')) {
    name = parts[2] ? (visibleName ? `Thread by ${visibleName}` : 'Thread') : visibleName || 'Profile'
  } else if (parts[1] === 'lists' && parts[2]) {
    name = visibleName || 'List'
  }
  return `${name || 'Not found'} · Caribou`
}

// Keep the server and client guards equal even when the client can render
// an author's name beside covered thread content.
export function profileTitleName(account?: Account): string | undefined {
  if (!account) return undefined
  if (account.bluesky) {
    const view = account.bluesky.moderation?.contexts.profileView
    if (!view || view.blur || view.filter) return undefined
  }
  return account.displayName || account.username || undefined
}

export function threadTitleName(status?: Status): string | undefined {
  if (!status) return undefined
  if (status.bluesky) {
    const view = status.bluesky.moderation?.contexts.contentView
    if (!view || view.blur || view.filter) return undefined
  }
  return profileTitleName(status.account)
}
