// Caribou's own profile page for an account. Every `/@acct@host` path is
// built here: the status card's author link, boost line and mentions, and the
// notifications list.
//
// `acct` is relative to the instance the data came from: a local account has
// no `@host` part, so add the host. The rules, in order (spec 8.4):
//
// 1. An acct with a host is used as it is.
// 2. Else the host given.
// 3. Else the host of the account's `url` (http or https only).
// 4. Else a bare `/@name`, but never with a dot: a bare dotted name is a
//    Bluesky handle route now. A dotted name links to a search for it.
export function profilePath(acct: string, host: string, url?: string | null): string {
  if (acct.includes('@')) return `/@${acct}`
  const known = host || hostOf(url)
  if (known) return `/@${acct}@${known}`
  if (acct.includes('.')) return `/search?q=${encodeURIComponent(`@${acct}`)}`
  return `/@${acct}`
}

function hostOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : ''
  } catch {
    return ''
  }
}

interface AnyAccount {
  acct: string
  url?: string | null | undefined
  bluesky?: { did: string; handleInvalid: boolean } | undefined
}

/**
 * The profile path for an account of either network (spec 6.3 seam 9,
 * 8.4). A Bluesky account is `/@<handle>`, never with a host, or
 * `/@<did>` when its handle is not valid. A Mastodon account is
 * `profilePath(acct, host)`.
 */
export function accountPath(account: AnyAccount, host: string): string {
  const b = account.bluesky
  if (b) return `/@${b.handleInvalid ? b.did : account.acct}`
  return profilePath(account.acct, host, account.url)
}

/**
 * The thread link for a post of either network. A Bluesky post is
 * `/@<handle or did>/<rkey>`, the rkey being the last part of its AT URI.
 * A Mastodon post is `/@<acct>/<encoded id>`, as it always was, except that
 * it never has a bare dotted name (spec 8.4: that is a Bluesky route). A
 * dotted local acct takes `host`, else the host of the account's url. With
 * neither, the link is the post's own `url` on its server when that is an
 * http(s) URL, and `null` (no link) when it is not. A path starts with `/`;
 * anything else is an outside URL.
 */
export function postPath(post: {
  id: string; account: AnyAccount; url?: string | null | undefined; bluesky?: { uri: string } | undefined
}, host = ''): string | null {
  if (post.bluesky) {
    const rkey = post.bluesky.uri.slice(post.bluesky.uri.lastIndexOf('/') + 1)
    return `${accountPath(post.account, '')}/${encodeURIComponent(rkey)}`
  }
  const { acct, url } = post.account
  const id = encodeURIComponent(post.id)
  if (acct.includes('@') || !acct.includes('.')) return `/@${acct}/${id}`
  const known = host || hostOf(url)
  if (known) return `/@${acct}@${known}/${id}`
  return hostOf(post.url) ? new URL(post.url!).href : null
}
