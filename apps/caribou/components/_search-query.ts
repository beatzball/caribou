// The /search address: `q` is the query, `type` the tab. The address is the
// one source of truth for both, so a deep link, Back and Forward all show
// the same search.
import type { SearchType } from '@beatzball/caribou-mastodon-client'
import { profilePath } from './_profile-path.js'

export const SEARCH_TABS: readonly { type: SearchType; label: string }[] = [
  { type: 'accounts', label: 'People' },
  { type: 'hashtags', label: 'Hashtags' },
  { type: 'statuses', label: 'Posts' },
]

const DEFAULT_TYPE: SearchType = 'accounts'

export interface SearchState { q: string; type: SearchType }

function isType(value: unknown): value is SearchType {
  return SEARCH_TABS.some((t) => t.type === value)
}

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v)

/** Reads the search from `location.search` or from the server's parsed query. */
export function parseSearch(source: string | Record<string, unknown>): SearchState {
  let q: unknown
  let type: unknown
  if (typeof source === 'string') {
    const params = new URLSearchParams(source)
    q = params.get('q')
    type = params.get('type')
  } else {
    q = first(source.q)
    type = first(source.type)
  }
  return { q: typeof q === 'string' ? q : '', type: isType(type) ? type : DEFAULT_TYPE }
}

/** The address of a search. People is the default tab, so it has no `type`. */
export function searchPath(q: string, type: SearchType): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (type !== DEFAULT_TYPE) params.set('type', type)
  const query = params.toString()
  return query ? `/search?${query}` : '/search'
}

/** True for a pasted web address, which the server may resolve to a post or a profile. */
export function isUrlQuery(q: string): boolean {
  const text = q.trim()
  if (!/^https?:\/\/\S+$/i.test(text)) return false
  try {
    return new URL(text).hostname.length > 0
  } catch {
    return false
  }
}

interface FoundAccount { acct: string; username?: string; url?: string | null; uri?: string | null }
interface FoundStatus {
  id: string; url?: string | null; uri: string; account: FoundAccount
  reblog?: FoundStatus | null
}

// A username, then an optional `@domain`. Nothing that could leave the
// profile path: no `/`, `?`, `#`, empty label or leading dot.
const ACCT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/

function validAccount(a: unknown): a is FoundAccount {
  return !!a && typeof a === 'object' && typeof (a as FoundAccount).acct === 'string'
    && ACCT.test((a as FoundAccount).acct)
}

// An id that stays one path segment: not `.` or `..`, and one that
// `encodeURIComponent` can encode (no lone surrogate).
function encodedId(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0 || id === '.' || id === '..') return null
  try {
    return encodeURIComponent(id)
  } catch {
    return null
  }
}

function validStatus(s: unknown): s is FoundStatus {
  if (!s || typeof s !== 'object') return false
  const st = s as FoundStatus
  if (encodedId(st.id) === null || !validAccount(st.account)) return false
  // A boost shows the boosted post, so that one must be whole too.
  return st.reblog == null || validStatus(st.reblog)
}

function validTag(t: unknown): t is { name: string } {
  return !!t && typeof t === 'object' && typeof (t as { name?: unknown }).name === 'string'
    && (t as { name: string }).name.length > 0
}

/**
 * The answer with every entry the page cannot use taken out: a post with
 * no usable id or author, an account whose acct would not make a profile
 * path, a hashtag with no name. The rest is cached and shown as it is.
 */
export function cleanSearch<S extends { accounts: readonly unknown[]; statuses: readonly unknown[]; hashtags: readonly unknown[] }>(
  data: S,
): S {
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  return {
    ...data,
    // A listed account also needs its id: the row and its Follow button use it.
    accounts: list(data?.accounts).filter((a) => validAccount(a)
      && typeof (a as unknown as { id?: unknown }).id === 'string' && (a as unknown as { id: string }).id.length > 0),
    statuses: list(data?.statuses).filter(validStatus),
    hashtags: list(data?.hashtags).filter(validTag),
  }
}

function parse(url: string | null | undefined): URL | null {
  if (typeof url !== 'string') return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

const lastSegment = (u: URL): string =>
  decodeURIComponent(u.pathname.replace(/\/+$/, '').split('/').pop() ?? '').replace(/^@/, '').toLowerCase()

// Whether `x` is the thing at `address` under another address form on the
// same server: same host, and the address's last path segment is the last
// segment of the thing's own `url` or `uri` (`/@bob/5`, `/users/bob/statuses/5`
// and `/web/statuses/5` all end in 5), or, for an account, its username.
function sameThing(address: URL, x: { url?: string | null; uri?: string | null; username?: string; acct?: string }): boolean {
  const host = address.hostname.toLowerCase()
  let key: string
  try {
    key = lastSegment(address)
  } catch {
    return false
  }
  if (!key) return false
  const names = [x.url, x.uri].map(parse).filter((u): u is URL => !!u && u.hostname.toLowerCase() === host)
  if (names.length === 0) return false
  if (names.some((u) => { try { return lastSegment(u) === key } catch { return false } })) return true
  const username = (x.username ?? x.acct?.split('@')[0] ?? '').toLowerCase()
  return username !== '' && username === key
}

/**
 * The in-app page for a resolved web address: the thread of the post, or
 * the profile of the account, that the address names. Null when the answer
 * does not name one thing. `host` is the server that answered, since its
 * ids and its local accts are the ones in the result.
 *
 * A result whose `url` or `uri` is the address is that thing. A lone
 * result is taken only when it is the same thing under another address
 * form on the address's own server (`sameThing`); a server that
 * text-searched the address may answer with something unrelated. A short
 * link that the server followed to another host is not opened.
 */
export function resolvedPath(
  q: string,
  result: { accounts: readonly unknown[]; statuses: readonly unknown[] },
  host: string,
): string | null {
  if (!isUrlQuery(q)) return null
  const url = q.trim()
  const address = parse(url)
  if (!address) return null
  const named = (x: { url?: string | null; uri?: string | null }) => x.url === url || x.uri === url
  const { statuses, accounts } = cleanSearch({ ...result, hashtags: [] })
  const lone = <T extends FoundAccount | FoundStatus>(list: readonly T[], others: readonly unknown[]) =>
    list.length === 1 && others.length === 0 && sameThing(address, list[0]!) ? list[0] : undefined
  const status = (statuses as FoundStatus[]).find(named) ?? lone(statuses as FoundStatus[], accounts)
  const path = status
    ? `${profilePath(status.account.acct, host)}/${encodedId(status.id)}`
    : (() => {
        const account = (accounts as FoundAccount[]).find(named) ?? lone(accounts as FoundAccount[], statuses)
        return account ? profilePath(account.acct, host) : null
      })()
  return path !== null && inAppRoute(path) ? path : null
}

// The last check before history changes: the path is `/@acct` or
// `/@acct/id`, and the browser reads it back unchanged (no dot segment).
function inAppRoute(path: string): boolean {
  if (!/^\/@[^/?#]+(?:\/[^/?#]+)?$/.test(path)) return false
  try {
    return new URL(path, 'https://caribou.invalid').pathname === path
  } catch {
    return false
  }
}
