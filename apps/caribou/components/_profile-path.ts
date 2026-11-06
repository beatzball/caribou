// Caribou's own profile page for an account. Every `/@acct@host` path is
// built here: the status card's author link, boost line and mentions, and the
// notifications list.
//
// `acct` is relative to the instance the data came from: a local account has
// no `@host` part, so add the host. With no host known, the bare handle is the
// best there is.
export function profilePath(acct: string, host: string): string {
  return `/@${acct.includes('@') || !host ? acct : `${acct}@${host}`}`
}

interface AnyAccount {
  acct: string
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
  return profilePath(account.acct, host)
}

/**
 * The thread path for a post of either network. A Bluesky post is
 * `/@<handle or did>/<rkey>`, the rkey being the last part of its AT URI.
 * A Mastodon post is `/@<acct>/<encoded id>`, as it always was.
 */
export function postPath(post: {
  id: string; account: AnyAccount; bluesky?: { uri: string } | undefined
}): string {
  if (post.bluesky) {
    const rkey = post.bluesky.uri.slice(post.bluesky.uri.lastIndexOf('/') + 1)
    return `${accountPath(post.account, '')}/${encodeURIComponent(rkey)}`
  }
  return `/@${post.account.acct}/${encodeURIComponent(post.id)}`
}
