// Which routes name a Bluesky account (spec 8.4; app README, "Bluesky
// SSR"). The page data and the client-rendered Bluesky views both read
// these rules, so a route means the same on the server and in the browser.

import type { CaribouClient } from '@beatzball/caribou-mastodon-client'

/** What a `/@<segment>` route names (spec 8.4). */
export type RouteOf =
  | { network: 'mastodon'; remote: boolean }
  | { network: 'bluesky'; by: 'did' | 'handle'; actor: string }

/**
 * The route rules, checked in this order: (1) a second `@` is a remote
 * Mastodon account; (2) `did:` is Bluesky by DID; (3) a dot is a Bluesky
 * handle; (4) no dot is a local Mastodon account. Syntax is not checked
 * here: the server checks it before it fetches.
 */
export function routeOf(segment: string): RouteOf {
  const name = segment.replace(/^@/, '')
  if (name.includes('@')) return { network: 'mastodon', remote: true }
  if (name.startsWith('did:')) return { network: 'bluesky', by: 'did', actor: name }
  if (name.includes('.')) return { network: 'bluesky', by: 'handle', actor: name }
  return { network: 'mastodon', remote: false }
}

/**
 * Rule 5: `/@<segment>/<id>` is a Bluesky post when the segment is a
 * Bluesky one (rule 2 or 3). The id's shape decides nothing.
 */
export function postRouteOf(segment: string, id: string):
  | { network: 'bluesky'; actor: string; rkey: string }
  | { network: 'mastodon' } {
  const route = routeOf(segment)
  return route.network === 'bluesky' ? { network: 'bluesky', actor: route.actor, rkey: id } : { network: 'mastodon' }
}

/** The Bluesky actor a `/@<handle>` segment names, or null for a Mastodon one (`routeOf`). */
export function blueskyActor(segment: string): string | null {
  const route = routeOf(segment)
  return route.network === 'bluesky' ? route.actor : null
}

/**
 * The `/@<segment>` of an address, decoded, or '' when the path is not a
 * profile or thread route. The client reads it when the page data does not
 * carry the handle (a hidden account, spec 8.3).
 */
export function routeSegment(pathname: string): string {
  const m = /^\/@([^/]+)/.exec(pathname)
  return m ? decodeSegment(m[1]!) : ''
}

/**
 * The post id of a `/@<segment>/<id>` address, decoded, or ''. The client
 * reads it when the page data does not carry it (a deferred page, #187).
 */
export function routePostId(pathname: string): string {
  const m = /^\/@[^/]+\/([^/]+)/.exec(pathname)
  return m ? decodeSegment(m[1]!) : ''
}

/**
 * A route segment as both sides read it: percent-decoded once, so
 * `/@did%3Aplc%3Aalice` is `/@did:plc:alice` on the server and in the
 * client. A segment that does not decode (a stray `%`) is ''.
 */
export function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return ''
  }
}

/**
 * A page opened by DID shows the handle form in the address bar (spec 8.4).
 * Call it in `firstUpdated`, never in `render`. It does nothing unless the
 * segment is a DID and the account has a valid handle. `rest` is what
 * follows the segment (a thread's `/<rkey>`).
 */
export function replaceDidRoute(
  win: Pick<Window, 'history' | 'location'>,
  segment: string,
  account: { acct: string; bluesky?: { did: string; handleInvalid: boolean } | undefined },
  rest = '',
): void {
  const route = routeOf(segment)
  const b = account.bluesky
  if (route.network !== 'bluesky' || route.by !== 'did' || !b || b.handleInvalid) return
  if (b.did !== route.actor || !account.acct.includes('.')) return
  const { search, hash } = win.location
  win.history.replaceState(win.history.state, '', `/@${account.acct}${rest}${search}${hash}`)
}

/**
 * The AT URI of the post `/@<actor>/<rkey>` names. Pass a DID for a
 * signed-in read: the AppView resolves a handle in `getPostThread` but
 * answers `getPosts` with a 500 for one (#271).
 */
export function blueskyPostUri(actor: string, rkey: string): string {
  return `at://${actor}/app.bsky.feed.post/${rkey}`
}

/** The DID in a Bluesky user key (`<did>@bsky`). */
export function didOfUserKey(userKey: string): string {
  return userKey.slice(0, userKey.lastIndexOf('@'))
}

/**
 * True when this browser renders Bluesky views itself: the active account
 * is a Bluesky one. Reader state: read it after the first render, never in
 * it.
 */
export function rendersBluesky(client: Pick<CaribouClient, 'capabilities'> | null): boolean {
  return client?.capabilities.network === 'bluesky'
}

/** Where the reader is: the path and query, as a key for `stillOn`. */
export function routeKey(win: Pick<Window, 'location'>): string {
  return `${win.location.pathname}${win.location.search}`
}

/**
 * True when a page may still use a result it waited for: it is connected
 * and the address is the one it started from. A browser fallback (#187)
 * checks it before it sets its data and before it touches the address bar,
 * so a late answer never changes another page's address.
 */
export function stillOn(el: Element, win: Pick<Window, 'location'>, key: string): boolean {
  return el.isConnected && routeKey(win) === key
}
